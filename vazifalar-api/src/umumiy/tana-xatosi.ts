// tana-xatosi.ts — Express xato middleware'i (4 argument): body-parser (express.json) va serve-static xatolarini IlovaXatosi ga aylantiradi.
// Nima uchun kerak: Nest Express xatolarini o'z filtriga uzatishdan oldin "xaritalaydi" — SyntaxError (yaroqsiz JSON) → BadRequestException(err.message),
// va body-parser'ning `type` maydoni ("entity.parse.failed") yo'qoladi. Shuning uchun xatoni Nest'dan OLDIN o'zimiz tarjima qilamiz
import type { ErrorRequestHandler } from "express";
import { IlovaXatosi } from "./xatolar.ts";

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

export const tanaXatosi: ErrorRequestHandler = (xato: unknown, _req, _res, next) => {
  if (httpErrorsmi(xato) && xato.status < 500 && xato.expose) {
    const tur = typeof xato.type === "string" ? xato.type : "";
    next(new IlovaXatosi(xato.status, TANA_XATOLARI[tur] ?? xato.message, { cause: xato }));
    return;
  }
  next(xato);
};
