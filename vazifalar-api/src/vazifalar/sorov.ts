// sorov.ts — tekshirilgan ro'yxat query'sini (sxema.ts → RoyxatQuery) ombor so'roviga aylantirish: kursorni ochish, imzo, proyeksiya
// Konvensiya: ?bajarildi=true&teg=uy&teg=ish&q=non&sort=-yaratildi,matn&fields=id,matn&limit=20&offset=40 | &cursor=...&jami=true
import { ParametrXatosi } from "../umumiy/xatolar.ts";
import { kursorOqi } from "../umumiy/kursor.ts";
import { keyingiKun, kunBoshiUtc } from "../umumiy/sana.ts";
import type { Filtr, RoyxatSorovi } from "./ombor.ts";
import type { Maydon, RoyxatQuery } from "./sxema.ts";
import type { Vazifa } from "./vazifa.ts";

export type TekshirilganSorov = { sorov: RoyxatSorovi; maydonlar?: Maydon[]; imzo: string };

/** @param tz foydalanuvchi kuni qaysi mintaqada (config APP_TZ) — saqlangan vaqt esa UTC */
export function royxatSorovi(q: RoyxatQuery, tz = "Asia/Tashkent", kursorKaliti?: Buffer): TekshirilganSorov {
  const filtr: Filtr = {};
  if (q.dan !== undefined) filtr.yaratildiDan = kunBoshiUtc(q.dan, tz);
  if (q.gacha !== undefined) filtr.yaratildiGacha = kunBoshiUtc(keyingiKun(q.gacha), tz);
  if (q.bajarildi !== undefined) filtr.bajarildi = q.bajarildi;
  if (q.teg !== undefined) filtr.teglar = q.teg;
  if (q.q !== undefined) filtr.qidiruv = q.q;
  const saralash = q.sort ?? [];
  // Imzo — kursor boshqa filtr/saralash bilan qayta ishlatilmasin
  const imzo = JSON.stringify([saralash, filtr]);
  let sahifa: RoyxatSorovi["sahifa"];
  if (q.cursor !== undefined) {
    const keyin = kursorOqi(q.cursor, imzo, kursorKaliti);
    if (keyin === undefined) throw new ParametrXatosi("cursor yaroqsiz yoki boshqa saralash/filtr uchun", [{ joy: "query.cursor", xabar: "yaroqsiz" }]);
    sahifa = { tur: "kursor", keyin };
  } else {
    // Parametrsiz — kursor rejimi (birinchi sahifa); offset faqat aniq so'ralganda
    sahifa = q.offset === undefined ? { tur: "kursor" } : { tur: "offset", offset: q.offset };
  }
  const sorov: RoyxatSorovi = { filtr, saralash, limit: q.limit, sahifa };
  if (q.jami !== undefined) sorov.jami = q.jami;
  return q.fields === undefined ? { sorov, imzo } : { sorov, maydonlar: q.fields, imzo };
}

/** Sparse fieldsets: faqat so'ralgan maydonlar */
export function proyeksiya(v: Vazifa, maydonlar: readonly Maydon[] | undefined): Partial<Vazifa> {
  if (maydonlar === undefined) return v;
  return Object.fromEntries(maydonlar.map((m) => [m, v[m]]));
}
