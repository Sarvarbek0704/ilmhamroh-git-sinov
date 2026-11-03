// middleware.ts — #07 (holat 07): kim so'rayapti. kimlik() — cookie'dagi sessiyani tekshiradi va req.sessiya ni qo'yadi (bo'lmasa — jim o'tadi);
// 30 B: kirishKerak (401/403) — KirishGuard'ga ko'chdi (qoriqchi.ts); bu yerda egasiniAniqla() — req.egasi + CLS.
import type { RequestHandler } from "express";
import { IlovaXatosi } from "../umumiy/xatolar.ts";
import { cookieNomi, cookieOl } from "./sessiya.ts";
import type { SessiyaOmbori } from "./sessiya.ts";
import type { ApiKalitlar } from "./api-kalit.ts";

export class KirilmaganXatosi extends IlovaXatosi {
  constructor() {
    // RFC 9110: 401 javobida WWW-Authenticate bo'lishi kerak. Cookie sessiyasi uchun standart sxema yo'q — o'zimizniki, brauzer oynasini ochmaydi
    super(401, "Avval tizimga kiring", { kod: "kirish-kerak", sarlavha: "Kirish kerak", httpSarlavhalar: { "WWW-Authenticate": 'Cookie realm="vazifalar"' } });
  }
}

/**
 * Kimlik: cookie sessiyasi (brauzer) yoki #22 dan "Authorization: Bearer vz_…" API kaliti (dastur). Noto'g'ri Bearer — darhol 401 (jim o'tkazilmaydi:
 * kalit eskirgan bo'lsa dastur buni bilsin); noto'g'ri cookie — jim (anonim so'rov sifatida davom).
 */
export function kimlik(sessiyalar: SessiyaOmbori, apiKalitlar?: ApiKalitlar): RequestHandler {
  const nom = cookieNomi(sessiyalar.s);
  return async (req, _res, next) => {
    const auth = req.get("authorization");
    if (auth !== undefined && apiKalitlar !== undefined) {
      const m = /^Bearer (\S{1,200})$/.exec(auth);
      const k = m?.[1] === undefined ? undefined : await apiKalitlar.tekshir(m[1]);
      if (k === undefined) throw new IlovaXatosi(401, "API kaliti yaroqsiz, bekor qilingan yoki muddati o'tgan", { kod: "api-kalit-xato", sarlavha: "Kalit yaroqsiz", httpSarlavhalar: { "WWW-Authenticate": 'Bearer realm="vazifalar", error="invalid_token"' } });
      req.apiKalit = k;
      next();
      return;
    }
    const token = cookieOl(req.headers.cookie, nom);
    if (token !== undefined) {
      const s = await sessiyalar.tekshir(token);
      if (s !== undefined) req.sessiya = s;
    }
    next();
  };
}

/**
 * 30 B: egasini aniqlash — guard'dan OLDIN (Express middleware): API kaliti → kalit egasi, sessiya → foydalanuvchi, DEV rejim (auth yo'q) → EGASI_ID.
 * Ruxsat tekshiruvi (401/403, API kaliti ruxsatlari) — KirishGuard (qoriqchi.ts); bu yerda faqat "kim". CLS'ga ham yoziladi (xizmatlar ombor tanlaydi)
 */
export function egasiniAniqla(devEgasi: number | undefined, clsga: (egasi: number) => void): RequestHandler {
  return (req, _res, next) => {
    const e = req.apiKalit?.foydalanuvchiId ?? req.sessiya?.foydalanuvchi.id ?? devEgasi;
    if (e !== undefined) {
      req.egasi = e;
      clsga(e);
    }
    next();
  };
}
