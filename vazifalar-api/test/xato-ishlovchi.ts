// (test yordamchisi — 28-qism src/umumiy/xato-ishlovchi.ts nusxasi: Nest versiyasida xatolar ProblemDetailsFilter orqali; csrf/api-kalit middleware testlari xom Express bilan) xato-ishlovchi.ts — global xato ishlovchi (4 argumentli middleware, eng oxirida): hamma xato bir joyda Problem Details'ga aylanadi
import type { ErrorRequestHandler, RequestHandler } from "express";
import { IlovaXatosi, TopilmadiXatosi } from "../src/umumiy/xatolar.ts";
import { problemYasa, problemYubor } from "../src/umumiy/problem.ts";

// body-parser xatolari (`type` maydoni) → o'zbekcha tafsilot
const TANA_XATOLARI: Record<string, string> = {
  "entity.parse.failed": "Tana yaroqli JSON emas",
  "entity.too.large": "Tana 16 KB dan katta",
  "encoding.unsupported": "Kodlash qo'llab-quvvatlanmaydi",
  "charset.unsupported": "Belgilar to'plami qo'llab-quvvatlanmaydi",
};

/** http-errors (body-parser, serve-static): status + expose */
function httpErrorsmi(x: unknown): x is Error & { status: number; expose: boolean; type?: unknown } {
  return x instanceof Error && "status" in x && typeof x.status === "number" && "expose" in x && typeof x.expose === "boolean";
}

/** Hech bir marshrut mos kelmadi — routerlardan keyin */
export const topilmadi: RequestHandler = (req) => {
  throw new TopilmadiXatosi(`${req.method} ${req.path} — bunday manzil yo'q`);
};

export type XatoLogi = (sorovId: string, xato: unknown) => void;

export function xatoIshlovchi(logla: XatoLogi = (id, x) => { console.error(`[${id}]`, x); }): ErrorRequestHandler {
  return (xato: unknown, req, res, next) => {
    if (res.headersSent) {
      // javob yarmida — status o'zgartirib bo'lmaydi; Express o'zi ulanishni uzadi
      logla(req.sorovId, xato);
      next(xato);
      return;
    }
    const umumiy = { instance: req.originalUrl, sorovId: req.sorovId };
    if (xato instanceof IlovaXatosi) {
      res.set(xato.httpSarlavhalar);
      problemYubor(res, problemYasa(xato.holat, { ...umumiy, kod: xato.kod, sarlavha: xato.sarlavha, detail: xato.message, xatolar: xato.xatolar }));
      return;
    }
    if (httpErrorsmi(xato) && xato.status < 500 && xato.expose) {
      const tur = typeof xato.type === "string" ? xato.type : "";
      problemYubor(res, problemYasa(xato.status, { ...umumiy, detail: TANA_XATOLARI[tur] ?? xato.message }));
      return;
    }
    // Kutilmagan (dasturchi xatosi, DB uzilishi…): tafsilot (stack, xabar) mijozga BERILMAYDI — faqat logga
    logla(req.sorovId, xato);
    problemYubor(res, problemYasa(500, { ...umumiy, detail: "Kutilmagan xato. sorovId bilan murojaat qiling." }));
  };
}
