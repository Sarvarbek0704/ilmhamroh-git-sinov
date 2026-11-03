// seed.ts — #39 DB-100 (holat 39): ishlab chiqish/demo ma'lumoti. `npx prisma db seed` (prisma.config.ts → migrations.seed) yoki `npm run db:seed`.
// Qoidalar: (1) DETERMINISTIK — faker.seed(27): har ishga tushirishda bir xil ma'lumot (skrinshot, test, bug qayta yaratish uchun);
// (2) IDEMPOTENT — faqat o'zi yaratgan foydalanuvchilarni (email …@seed.example) o'chirib qayta yozadi, boshqa ma'lumotga tegmaydi;
// (3) PRODUCTION'DA ISHLAMAYDI — NODE_ENV=production bo'lsa to'xtaydi (26-qism: seed.ts prodda jadvallarni tozalagan voqea — kurs README'si).
// Hajm: SEED_FOYDALANUVCHI (sukut 20) × 0–30 vazifa, izohlar. Ism-sharif va shaharlar — fakerUZ_UZ_latin.
import { fakerUZ_UZ_latin as faker } from "@faker-js/faker";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

if (process.env["NODE_ENV"] === "production") {
  console.error("seed: NODE_ENV=production — to'xtatildi (seed faqat lokal/staging uchun)");
  process.exit(1);
}
const url = process.env["DATABASE_URL"];
if (url === undefined) {
  console.error("seed: DATABASE_URL yo'q");
  process.exit(1);
}
const SONI = Number(process.env["SEED_FOYDALANUVCHI"] ?? "20");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
faker.seed(27);

const ISHLAR = ["Hisobot yozish", "Bozordan non olish", "Kitob o'qish", "Mashq qilish", "Qo'ng'iroq qilish", "To'lov qilish", "Xat yuborish", "Kod review", "Darsga tayyorlanish", "Uchrashuv"];
const TEGLAR = ["#ish", "#uy", "#bozor", "#o'qish", "#sport", "#oila", "#to'lov", "#server"];

const t0 = performance.now();
const ochirildi = await db.foydalanuvchi.deleteMany({ where: { email: { endsWith: "@seed.example" } } });
let vazifalar = 0;
let izohlar = 0;
for (let i = 1; i <= SONI; i++) {
  const f = await db.foydalanuvchi.create({
    data: { email: `foydalanuvchi${String(i)}@seed.example`, toliqIsm: faker.person.fullName(), sozlamalar: { til: faker.helpers.arrayElement(["uz-Latn", "uz-Cyrl", "ru", "en"]) } },
    select: { id: true },
  });
  const n = faker.number.int({ min: 0, max: 30 });
  // createMany — bitta INSERT (ko'p VALUES); tartib trigger'i har qatorga ishlaydi. Matn noyob bo'lishi uchun raqam qo'shiladi (014 EXCLUDE)
  const r = await db.vazifa.createManyAndReturn({
    data: Array.from({ length: n }, (_, j) => {
      const bajarildi = faker.datatype.boolean({ probability: 0.4 });
      return {
        egasiId: f.id,
        matn: `${faker.helpers.arrayElement(ISHLAR)} ${String(j + 1)} ${faker.helpers.arrayElement(TEGLAR)}`,
        bajarildi,
        bajarilganVaqt: bajarildi ? faker.date.recent({ days: 30, refDate: "2026-10-25T00:00:00Z" }) : null,
        ustuvorlik: faker.helpers.arrayElement(["past", "orta", "orta", "yuqori"] as const),
      };
    }),
    select: { id: true },
  });
  vazifalar += r.length;
  const iz = r.flatMap((v) => Array.from({ length: faker.number.int({ min: 0, max: 2 }) }, () => ({ vazifaId: v.id, muallifId: f.id, matn: faker.helpers.arrayElement(["Bajarildi", "Ertaga qilaman", "Yordam kerak", "Muddatni uzaytirish kerak"]) })));
  izohlar += (await db.izoh.createMany({ data: iz })).count;
}
console.log(`seed: o'chirildi ${String(ochirildi.count)} eski seed foydalanuvchi; yaratildi ${String(SONI)} foydalanuvchi, ${String(vazifalar)} vazifa, ${String(izohlar)} izoh — ${(performance.now() - t0).toFixed(0)} ms`);
await db.$disconnect();
