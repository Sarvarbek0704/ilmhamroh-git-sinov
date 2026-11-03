// prisma-ombor.test.ts — PrismaOmbori (27-qism): xotira/fayl/pg omborlari o'tgan SHARTNOMA testlari + PgOmbori'ning asosiy Postgres testlari.
// Baza: TEST_PRISMA_DATABASE_URL — pg-ombor.test.ts dan ALOHIDA baza (sukut vazifalar_test_prisma). node --test fayllarni parallel
// jarayonlarda ishga tushiradi: ikkala fayl bitta bazada TRUNCATE qilsa, bir-birining ma'lumotini o'chiradi (holat 20 da 2 test shunday
// yiqildi — BT-10 "test DB strategiyalari" misoli). Sxema: qur.sh --namunasiz --baza vazifalar_test_prisma. Baza yo'q bo'lsa — SKIP.
import { afterAll, describe, test } from "vitest";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { omborShartnomasi } from "./ombor-shartnoma.ts";
import { PrismaOmbori } from "../src/vazifalar/prisma-ombor.ts";
import { pgPool } from "../src/vazifalar/pg-ombor.ts";
import { KonfliktXatosi } from "../src/umumiy/xatolar.ts";
import type { Pool } from "pg";

const URL = process.env["TEST_PRISMA_DATABASE_URL"] ?? "postgres://postgres@127.0.0.1:5498/vazifalar_test_prisma";

async function ulan(): Promise<{ pool: Pool; db: PrismaClient } | string> {
  const pool = pgPool(URL, { max: 2, connectionTimeoutMillis: 10_000 });
  try {
    await pool.query("SELECT tartib FROM vazifalar LIMIT 0");
  } catch (x) {
    await pool.end();
    return `test bazasi yo'q (${URL}): ${x instanceof Error ? x.message : String(x)}`;
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL, max: 5, connectionTimeoutMillis: 10_000 }) });
  return { pool, db };
}

async function tozala(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE foydalanuvchilar, vazifalar, teglar, vazifa_teglari, izohlar, vazifa_tarixi RESTART IDENTITY CASCADE");
  await pool.query("INSERT INTO foydalanuvchilar (email, toliq_ism) VALUES ('test@example.com', 'Test'), ('boshqa@example.com', 'Boshqa')");
}

const ulanish = await ulan();

if (typeof ulanish === "string") {
  test.skip(`PrismaOmbori — ${ulanish}`, () => {});
} else {
  const { pool, db } = ulanish;
  afterAll(async () => {
    await db.$disconnect();
    await pool.end();
  });

  omborShartnomasi("prisma", async () => {
    await tozala(pool);
    return new PrismaOmbori(db, 1);
  });

  describe("PrismaOmbori: Postgres'ga xos (PgOmbori testlari bilan bir xil)", () => {
    test("takror matn — 409 (23P01 adapter xatosidan); o'chirilgandan keyin mumkin; id sequence'ni yeydi", async () => {
      await tozala(pool);
      const o = new PrismaOmbori(db, 1);
      await o.yarat({ matn: "Non olish" });
      await assert.rejects(o.yarat({ matn: "NON OLISH" }), (x: unknown) => x instanceof KonfliktXatosi && x.holat === 409 && x.kod === "takror-matn");
      await o.ochir(1);
      assert.equal((await o.yarat({ matn: "NON OLISH" })).id, 3);
    });

    test("29-qism B (holat 50): outbox — PgOmbori bilan bir xil hodisalar; takror matn rollback'ida hodisa yo'q", async () => {
      await tozala(pool);
      await pool.query("TRUNCATE outbox");
      const o = new PrismaOmbori(db, 1);
      const v = await o.yarat({ matn: "Non olish" });
      await assert.rejects(o.yarat({ matn: "NON OLISH" }));
      await o.yangila(v.id, { bajarildi: true });
      await o.yangila(v.id, { bajarildi: true });
      await o.ochir(v.id);
      const r = await pool.query<{ t: string }>("SELECT tur || ':' || (malumot->>'id') AS t FROM outbox ORDER BY id");
      assert.deepEqual(r.rows.map((x) => x.t), ["vazifa.yaratildi:1", "vazifa.yangilandi:1", "vazifa.bajarildi:1", "vazifa.yangilandi:1", "vazifa.ochirildi:1"]);
    });

    test("almashtirHammasi atomik: takror matn — 409, eski ro'yxat va versiya o'zgarmaydi; matnlarni almashtirish (014)", async () => {
      await tozala(pool);
      const o = new PrismaOmbori(db, 1);
      await o.yarat({ matn: "Non" });
      await o.yarat({ matn: "Sut" });
      const hammasi = { filtr: {}, saralash: [], limit: 10, sahifa: { tur: "kursor" as const } };
      const oldin = await o.royxat(hammasi);
      await assert.rejects(o.almashtirHammasi([{ matn: "Choy", bajarildi: false }, { matn: "choy", bajarildi: true }]), (x: unknown) => x instanceof KonfliktXatosi);
      const keyin = await o.royxat(hammasi);
      assert.deepEqual(keyin.vazifalar.map((v) => v.matn), ["Non", "Sut"]);
      assert.equal(keyin.versiya, oldin.versiya);
      const n = await o.almashtirHammasi([{ id: 1, matn: "Sut", bajarildi: false }, { id: 2, matn: "Non", bajarildi: false }]);
      assert.deepEqual(n.vazifalar.map((v) => [v.id, v.matn]), [[1, "Sut"], [2, "Non"]]);
    });

    test("egasi ajratilgan va injection: qidiruv '%' / \"' OR 1=1 --\" — oddiy matn; saralash maydoni — oq ro'yxat", async () => {
      await tozala(pool);
      const a = new PrismaOmbori(db, 1);
      const b = new PrismaOmbori(db, 2);
      await a.yarat({ matn: "Azizniki 100% #ish" });
      await a.yarat({ matn: "Boshqasi" });
      assert.equal(await b.ol(1), undefined);
      assert.equal((await b.yangila(1, { bajarildi: true })).tur, "topilmadi");
      const r = (qidiruv: string) => a.royxat({ filtr: { qidiruv }, saralash: [], limit: 10, sahifa: { tur: "kursor" } });
      assert.deepEqual((await r("%")).vazifalar.map((v) => v.id), [1]);
      assert.deepEqual((await r("_")).vazifalar.map((v) => v.id), []);
      assert.deepEqual((await r("' OR 1=1 --")).vazifalar.map((v) => v.id), []);
      await assert.rejects(a.royxat({ filtr: {}, saralash: [{ maydon: "constructor" as "id", kamayish: false }], limit: 10, sahifa: { tur: "kursor" } }));
    });

    test("matn bo'yicha kursor — COLLATE \"C\" (JS tartibi): katta harf kichikdan oldin, takrorsiz", async () => {
      await tozala(pool);
      const o = new PrismaOmbori(db, 1);
      for (const m of ["banan", "Olma", "anor", "Behi", "uzum"]) await o.yarat({ matn: m });
      const korilgan: string[] = [];
      let keyin: (string | number | boolean)[] | undefined;
      for (;;) {
        const s = await o.royxat({ filtr: {}, saralash: [{ maydon: "matn", kamayish: false }], limit: 2, sahifa: { tur: "kursor", ...(keyin === undefined ? {} : { keyin }) } });
        korilgan.push(...s.vazifalar.map((v) => v.matn));
        if (!s.borKeyingi) break;
        keyin = s.keyingi;
      }
      assert.deepEqual(korilgan, ["Behi", "Olma", "anor", "banan", "uzum"]);
    });

    test("raqobat: 30 parallel yarat — tartib takrorlanmaydi; bitta versiya bilan 10 PATCH — 1 ok", async () => {
      await tozala(pool);
      const o = new PrismaOmbori(db, 1);
      const v = await Promise.all(Array.from({ length: 30 }, (_, i) => o.yarat({ matn: `p${String(i)}` })));
      assert.equal(new Set(v.map((x) => x.tartib)).size, 30);
      const birVersiya = (await o.ol(1))?.versiya ?? 0;
      const n = await Promise.all(Array.from({ length: 10 }, (_, i) => o.yangila(1, { matn: `t${String(i)}` }, { versiya: birVersiya })));
      assert.equal(n.filter((x) => x.tur === "ok").length, 1);
    });
  });
}

if (typeof ulanish !== "string") {
  // 31 #34 (flaky): yolg'iz 10.7 s (Prisma klienti ikki marta ko'tariladi), parallel yuk ostida 20 s dan oshdi — o'z chegarasi 60 s
  test("omborYarat(prisma): SAQLASH=prisma — fail-fast va ishlaydi", { timeout: 60_000 }, async () => {
    const { omborOl, omborYarat } = await import("../src/ishga-tushir.ts");
    const { configYukla } = await import("../src/config.ts");
    await tozala(ulanish.pool);
    await assert.rejects(omborYarat(configYukla({ SAQLASH: "prisma", DATABASE_URL: URL.replace(/[^/]+$/, "yoq_baza"), EGASI_ID: "1" })), /does not exist/);
    assert.throws(() => configYukla({ SAQLASH: "prisma" }), /DATABASE_URL/);
    const s = await omborYarat(configYukla({ SAQLASH: "prisma", DATABASE_URL: URL, EGASI_ID: "1" }));
    assert.equal((await omborOl(s, 1).yarat({ matn: "prisma orqali" })).id, 1);
    await s.yop();
  });
}
