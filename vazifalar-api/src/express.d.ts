// express.d.ts — declaration merging: Express'ning Request turiga o'z maydonimizni qo'shamiz.
// Shu fayl bo'lmasa `req.sorovId` — TS xatosi ("Property 'sorovId' does not exist on type Request")
import type { JoriySessiya } from "./auth/sessiya.ts";
import type { KalitEgasi } from "./auth/api-kalit.ts";

declare global {
  namespace Express {
    interface Request {
      /** sorovId middleware'i qo'yadi (X-Request-Id yoki yangi UUID) */
      sorovId: string;
      /** kimlik() — haqiqiy sessiya bo'lsa (28-qism #07) */
      sessiya?: JoriySessiya;
      /** kimning ma'lumoti bilan ishlanadi: egasiniAniqla() (sessiya / API kaliti) yoki dev rejimda qat'iy EGASI_ID. Anonim so'rovda — yo'q (guard 401) */
      egasi?: number;
      /** #22: Bearer API kaliti bilan kelgan so'rov (sessiya o'rniga) */
      apiKalit?: KalitEgasi;
      /** #22: JSON tanasining xom baytlari — HMAC imzo tekshiruvi uchun (express.json verify) */
      xomTana?: Buffer;
    }
  }
}
