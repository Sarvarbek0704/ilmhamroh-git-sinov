// csrf.ts — #10 B-114 (holat 10): CSRF himoyasi. Sessiya cookie'si brauzer tomonidan HAR so'rovga o'zi qo'shiladi — boshqa sahifa ham shu cookie bilan
// so'rov yubora oladi. Uch qatlam: (1) SameSite=Lax (#07) — BOSHQA saytdan POST/fetch'da cookie yo'q; (2) JSON talab (jsonKerak, 415) — oddiy forma JSON
// yubora olmaydi; (3) shu middleware — o'zgartiruvchi so'rovda Origin (yoki Sec-Fetch-Site) tekshiruvi. (3) nega kerak: BIR SAYTning boshqa origin'i
// (localhost:5174 → localhost:3000, yoki eski.example.uz → api.example.uz) uchun SameSite himoya qilmaydi — 28 #10 e2e: holat 07 da forma bilan
// POST /v1/auth/chiqish-hammasi (tanasiz, jsonKerak yo'q) qurbonning hamma sessiyalarini bekor qildi (natijalar/tajriba/t10-csrf-zaif.txt).
// Double-submit token (csrf-csrf) — muqobil; kanonda kerak emas: Origin'ni brauzer qo'yadi, JS o'zgartira olmaydi (forbidden header).
import type { RequestHandler } from "express";
import { IlovaXatosi } from "../umumiy/xatolar.ts";

const XAVFSIZ = new Set(["GET", "HEAD", "OPTIONS"]);

export class CsrfXatosi extends IlovaXatosi {
  constructor(sabab: string) {
    super(403, `So'rov boshqa sahifadan kelgan (${sabab}) — rad etildi`, { kod: "csrf", sarlavha: "Ruxsatsiz manba" });
  }
}

/**
 * @param ishonchli o'z origin'imizdan tashqari ruxsat etilgan origin'lar (CORS ro'yxati — frontend)
 * Cookie'siz so'rov (curl, server-server, API kaliti — Authorization sarlavhasi) tekshirilmaydi: CSRF — faqat brauzer o'zi qo'shadigan ishonch ma'lumoti hujumi.
 */
export function csrfHimoya(ishonchli: readonly string[]): RequestHandler {
  const ruxsat = new Set(ishonchli);
  return (req, _res, next) => {
    if (XAVFSIZ.has(req.method) || req.headers.cookie === undefined) {
      next();
      return;
    }
    const origin = req.get("origin");
    if (origin !== undefined) {
      // "null" — sandbox iframe, file://, ba'zi redirect'lar: hech qachon ishonchli emas
      const oz = `${req.protocol}://${req.get("host") ?? ""}`;
      if (origin !== "null" && (origin === oz || ruxsat.has(origin))) {
        next();
        return;
      }
      throw new CsrfXatosi(`Origin: ${origin.slice(0, 100)}`);
    }
    // Origin yo'q (eski brauzer yoki brauzer emas): Fetch Metadata bo'lsa — faqat same-origin yoki foydalanuvchi o'zi (none)
    const sfs = req.get("sec-fetch-site");
    if (sfs === "cross-site" || sfs === "same-site") throw new CsrfXatosi(`Sec-Fetch-Site: ${sfs}`);
    next();
  };
}
