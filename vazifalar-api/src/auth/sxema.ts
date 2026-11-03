// sxema.ts — auth so'rovlari sxemalari (#05). z.strictObject: noma'lum maydon (`rol`, `isAdmin`) — 422, jim tashlanmaydi (mass assignment, #27).
// Parol siyosati — NIST SP 800-63B-4 (2025): faqat parol bilan kiriladigan hisobda kamida 15 belgi, kamida 64 belgigacha ruxsat, tarkib qoidalari
// ("katta harf + raqam + belgi") YO'Q, sizib chiqqan/keng tarqalgan parollar ro'yxati bilan tekshiruv, Unicode — NFC ga keltiriladi.
import { z } from "zod";
import { taqiqlanganmi } from "./taqiqlangan-parollar.ts";

export const PAROL_MIN = 15;
export const PAROL_MAKS = 128;

/** Email: bo'shliqlar olinadi, kichik harf (bazada lower(email) noyob — 001), uzunlik RFC 5321 chegarasi */
export const EmailSxemasi = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, { error: "email juda uzun" })
  .pipe(z.email({ error: "email noto'g'ri" }));

/** Parol: NFC (Ў bitta belgi ham, У + ˘ ham bir xil hash beradi — t04/parol.test), trim QILINMAYDI (bo'shliq ham belgi) */
export const Parol = z
  .string()
  .transform((p) => p.normalize("NFC"))
  .pipe(
    z
      .string()
      .min(PAROL_MIN, { error: `parol kamida ${String(PAROL_MIN)} belgi (NIST SP 800-63B-4). Bir nechta so'zdan iborat ibora — eslab qolish oson` })
      .max(PAROL_MAKS, { error: `parol ${String(PAROL_MAKS)} belgidan oshmasin` }),
  );

const ToliqIsm = z.string().trim().normalize("NFC").min(1, { error: "ism bo'sh" }).max(100, { error: "ism 100 belgidan oshmasin" });

export const RoyxatSxemasi = z
  // vebSayt — #30 honeypot: formada yashirin (CSS bilan), odam to'ldirmaydi, oddiy bot to'ldiradi
  .strictObject({ email: EmailSxemasi, toliqIsm: ToliqIsm, parol: Parol, eslabQol: z.boolean().default(false), vebSayt: z.string().max(200).optional() })
  .superRefine((x, ctx) => {
    const sabab = taqiqlanganmi(x.parol, [x.email, x.toliqIsm]);
    if (sabab !== undefined) ctx.issues.push({ code: "custom", input: x.parol, path: ["parol"], message: sabab });
  });
export type Royxat = z.output<typeof RoyxatSxemasi>;

/** Login: parol siyosati TEKSHIRILMAYDI (eski, qisqa parolli hisob ham kira olsin) — faqat uzunlik chegarasi (DoS: 1 MB parolni hash qilmaymiz) */
export const KirishSxemasi = z.strictObject({
  email: EmailSxemasi,
  parol: z.string().min(1, { error: "parol bo'sh" }).max(PAROL_MAKS * 4, { error: "parol juda uzun" }).transform((p) => p.normalize("NFC")),
  /** #11: "Meni eslab qol" — 30 kunlik cookie; yo'q/false — brauzer yopilguncha (qisqa idle) */
  eslabQol: z.boolean().default(false),
});
export type Kirish = z.output<typeof KirishSxemasi>;

/** #13: telefon (normallash va mamlakat — xizmatda), SMS kod */
const Telefon = z.string().max(30, { error: "telefon juda uzun" });
export const TelefonSxemasi = z.strictObject({ telefon: Telefon });
export const OtpKirishSxemasi = z.strictObject({ telefon: Telefon, kod: z.string().max(10), eslabQol: z.boolean().default(false) });
export const TelefonTasdiqSxemasi = z.strictObject({ telefon: Telefon, kod: z.string().max(10) });

/** #16: Telegram Login Widget ma'lumoti — Telegram JS id/auth_date ni son, qolganini satr beradi; imzo satr ko'rinishida tekshiriladi */
const TgQiymat = z.union([z.string().max(512), z.number().int().nonnegative()]).transform(String);
export const TelegramSxemasi = z.strictObject({
  id: TgQiymat, first_name: TgQiymat.optional(), last_name: TgQiymat.optional(), username: TgQiymat.optional(), photo_url: TgQiymat.optional(),
  auth_date: TgQiymat, hash: z.string().max(128), eslabQol: z.boolean().default(false),
});

/** #12: xatdagi havoladan token (frontend # dan oladi va POST qiladi) */
const Token = z.string().max(100, { error: "token juda uzun" });
export const TokenSxemasi = z.strictObject({ token: Token });
export const EmailSorovSxemasi = z.strictObject({ email: EmailSxemasi });
/** Yangi parol: uzunlik va umumiy ro'yxat shu yerda, shaxsiy ma'lumot (email, ism) — xizmatda (token egasi ma'lum bo'lgach) */
export const ParolTiklashSxemasi = z.strictObject({ token: Token, parol: Parol }).superRefine((x, ctx) => {
  const sabab = taqiqlanganmi(x.parol);
  if (sabab !== undefined) ctx.issues.push({ code: "custom", input: x.parol, path: ["parol"], message: sabab });
});

/** 31 #12: hisobni o'chirish — joriy parol (uzunlik cheklovi — DoS: argon2 ga cheksiz satr berilmasin) */
export const HisobOchirishSxemasi = z.strictObject({ parol: z.string().min(1).max(256) });
