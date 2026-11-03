// sxema.ts — vazifalar API'ning Zod sxemalari: bitta sxemadan ham ish vaqti tekshiruvi, ham TS turi (z.infer), ham JSON Schema (npm run sxema)
import { z } from "zod";
import { SARALASH_MAYDONLARI } from "./ombor.ts";
import type { Saralash, SaralashMaydoni } from "./ombor.ts";

// 22-qism frontend (Vazifa.MAKS_UZUNLIK) va 26-qism sxemasi (CHECK 1–100) bilan bir xil
export const MAKS_MATN = 100;
export const MAKS_TOPLAM = 1000;
export const SUKUT_LIMIT = 20;
export const MAKS_LIMIT = 100;
export const MAKS_OFFSET = 10_000;

const Matn = z
  .string({ error: "matn — satr bo'lishi kerak" })
  .trim()
  .min(1, { error: `matn 1–${String(MAKS_MATN)} belgi bo'lishi kerak` })
  .max(MAKS_MATN, { error: `matn 1–${String(MAKS_MATN)} belgi bo'lishi kerak` });
const Bajarildi = z.boolean({ error: "bajarildi — true yoki false" });

/** POST: matn majburiy; noma'lum maydon — xato (strictObject = oq ro'yxat) */
export const YangiVazifaSxemasi = z.strictObject({ matn: Matn, bajarildi: Bajarildi.optional() });
/** PUT /:id: hamma yoziladigan maydon majburiy */
export const ToliqVazifaSxemasi = z.strictObject({ matn: Matn, bajarildi: Bajarildi });
/** PATCH (JSON Merge Patch): kamida bitta maydon; `null` — "o'chir", majburiy maydonlar uchun xato */
export const OzgarishSxemasi = z
  .strictObject({ matn: Matn.optional(), bajarildi: Bajarildi.optional() })
  .refine((o) => o.matn !== undefined || o.bajarildi !== undefined, { error: "o'zgarish yo'q: matn yoki bajarildi" });
/** PUT /v1/vazifalar: butun to'plam */
export const ToplamSxemasi = z.strictObject({
  vazifalar: z.array(ToliqVazifaSxemasi.extend({ id: z.int().positive().optional() })).max(MAKS_TOPLAM),
});
/** POST /toplam: 1..100 element; elementlar alohida tekshiriladi (qisman muvaffaqiyat) */
export const BulkSxemasi = z.strictObject({ vazifalar: z.array(z.unknown()).min(1).max(100) });

export const IdSxemasi = z.strictObject({
  id: z.string().regex(/^[1-9]\d{0,9}$/, { error: "id — musbat butun son" }).transform(Number),
});

// ─── Ro'yxat query'si (Express 5 "simple" parser: qiymat — string yoki string[]) ───
const Bitta = (nom: string) => z.string({ error: `${nom} bir marta berilishi kerak` });
const Mantiqiy = (nom: string) =>
  Bitta(nom)
    .refine((x) => x === "true" || x === "false", { error: `${nom} — true yoki false` })
    .transform((x) => x === "true");
const Butun = (nom: string, min: number, max: number) =>
  Bitta(nom)
    .regex(/^\d{1,6}$/, { error: `${nom} — ${String(min)}..${String(max)} oralig'idagi butun son` })
    .transform(Number)
    .refine((n) => n >= min && n <= max, { error: `${nom} — ${String(min)}..${String(max)} oralig'idagi butun son` });
const TEG = /^[\p{L}\p{N}_'‘’]{1,50}$/u;
/** YYYY-MM-DD va haqiqiy kalendar sanasi (2026-02-30 — yo'q: Date uni 03-02 ga "to'g'rilab" yuboradi) */
function haqiqiySana(x: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const t = Date.parse(`${x}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(x);
}
const Sana = (nom: string) => Bitta(nom).refine(haqiqiySana, { error: `${nom} — YYYY-MM-DD (haqiqiy sana)` });
const MAYDONLAR = ["id", "matn", "bajarildi", "teglar", "tartib", "yaratildi", "yangilandi", "versiya"] as const;
export type Maydon = (typeof MAYDONLAR)[number];

export const RoyxatQuerySxemasi = z
  .strictObject(
    {
      bajarildi: Mantiqiy("bajarildi").optional(),
      teg: z
        .union([z.string(), z.array(z.string())])
        .transform((t) => [...new Set((Array.isArray(t) ? t : [t]).map((x) => x.replace(/^#/, "").toLowerCase()))])
        .pipe(z.array(z.string().regex(TEG, { error: "teg — harf, raqam, _ (50 belgigacha)" })).max(10))
        .optional(),
      q: Bitta("q").trim().min(1, { error: "q — 1..100 belgi" }).max(100, { error: "q — 1..100 belgi" }).optional(),
      sort: Bitta("sort")
        .transform((x, ctx): Saralash[] => {
          const natija: Saralash[] = [];
          for (const qism of x.split(",")) {
            const kamayish = qism.startsWith("-");
            const maydon = kamayish ? qism.slice(1) : qism;
            if (!(SARALASH_MAYDONLARI as readonly string[]).includes(maydon)) {
              ctx.issues.push({ code: "custom", input: x, message: `sort: noma'lum maydon "${maydon}" (mumkin: ${SARALASH_MAYDONLARI.join(", ")})` });
              return z.NEVER;
            }
            if (natija.some((s) => s.maydon === maydon)) {
              ctx.issues.push({ code: "custom", input: x, message: `sort: "${maydon}" takrorlangan` });
              return z.NEVER;
            }
            natija.push({ maydon: maydon as SaralashMaydoni, kamayish });
          }
          return natija;
        })
        .optional(),
      fields: Bitta("fields")
        .transform((x) => x.split(","))
        .pipe(z.array(z.enum(MAYDONLAR, { error: (i) => `fields: noma'lum maydon "${String(i.input)}"` })))
        .transform((m): Maydon[] => [...new Set<Maydon>(["id", ...m])])
        .optional(),
      limit: Butun("limit", 1, MAKS_LIMIT).default(SUKUT_LIMIT),
      offset: Butun("offset", 0, MAKS_OFFSET).optional(),
      cursor: Bitta("cursor").max(1000).optional(),
      jami: Mantiqiy("jami").optional(),
      // Mahalliy kalendar kuni (APP_TZ, sukut Asia/Tashkent): ?dan=2026-10-24&gacha=2026-10-24 — ikkalasi ham kiradi
      dan: Sana("dan").optional(),
      gacha: Sana("gacha").optional(),
    },
    { error: (i) => (i.code === "unrecognized_keys" ? `noma'lum parametr: ${i.keys.join(", ")}` : undefined) },
  )
  .refine((q) => q.offset === undefined || q.cursor === undefined, { error: "offset va cursor birga berilmaydi", path: ["cursor"] });

export type RoyxatQuery = z.output<typeof RoyxatQuerySxemasi>;

// ─── Eksport: discriminatedUnion — "format" maydoni qaysi variant ekanini aytadi ───
export const EksportSxemasi = z
  .discriminatedUnion(
    "format",
    [
      // Excel o'zbek/rus lokalida ";" ni kutadi — tanlash mumkin
      z.strictObject({ format: z.literal("csv"), ajratgich: z.enum([",", ";"]).default(",") }),
      z.strictObject({ format: z.literal("json") }),
    ],
    { error: "format — \"csv\" yoki \"json\"" },
  )
  .default({ format: "csv", ajratgich: "," });

export type EksportSorovi = z.output<typeof EksportSxemasi>;
