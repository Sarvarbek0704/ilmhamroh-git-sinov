// log.ts — strukturali (JSON) log: Pino. stdout'ga yoziladi (12-factor) — faylga yozish, rotatsiya, yig'ish — muhitning ishi (Docker, Loki — 34-qism).
// Correlation ID: har so'rov AsyncLocalStorage ichida — xizmat va fon ishlari ham joriy so'rov logger'ini oladi (req'ni uzatmasdan).
// 30-qism (holat 30): o'z AsyncLocalStorage'imiz o'rniga nestjs-cls konteksti — ClsMiddleware (ilova.ts) so'rov boshida req.log ni "log" kalitiga qo'yadi
import { ClsServiceManager } from "nestjs-cls";
import { pino } from "pino";
import type { DestinationStream, Logger, LoggerOptions } from "pino";
import { pinoHttp } from "pino-http";
import type { RequestHandler } from "express";

export type Log = Logger;

/** Hech qachon logga tushmasligi kerak bo'lgan joylar — qiymat "[yashirildi]" ga almashadi */
export const YASHIRIN = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
  "res.headers['set-cookie']",
  "*.parol",
  "*.token",
];

export function logYarat(daraja: string, manzil?: DestinationStream): Log {
  const sozlama: LoggerOptions = {
    level: daraja,
    // vaqt ISO ko'rinishda (epoch ms emas) — odam ham o'qisin; Toshkentga aylantirish — ko'rsatuvchi vositada
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: YASHIRIN, censor: "[yashirildi]" },
    base: { ilova: "vazifalar-api" },
    formatters: { level: (label) => ({ daraja: label }) },
  };
  return manzil === undefined ? pino(sozlama) : pino(sozlama, manzil);
}

/** CLS kalitlari (nestjs-cls): joriy so'rov logger'i; 28-qismda — joriy foydalanuvchi */
export const CLS_LOG = "log";

/** Joriy so'rovning logger'i (sorovId bilan); so'rovdan tashqarida (bootstrap, cron) — asosiy logger */
export function joriyLog(asosiy: Log): Log {
  const cls = ClsServiceManager.getClsService();
  return (cls.isActive() ? cls.get<Log | undefined>(CLS_LOG) : undefined) ?? asosiy;
}

/**
 * pino-http: har so'rov oxirida bitta qator (metod, yo'l, status, vaqt), sorovId — bizning X-Request-Id. sorovId() middleware'idan KEYIN,
 * ClsMiddleware'dan OLDIN qo'yiladi (CLS req.log ni oladi). Nest marshrutlaridan oldin (app.use) — statik fayl, JSON xatosi (400/413) va 404 ham loglanadi
 */
function asliYol(req: { url?: string | undefined }): string {
  const r = req as { originalUrl?: string; url?: string };
  return (r.originalUrl ?? r.url ?? "").split("?")[0] ?? "";
}

export function sorovLogi(log: Log): RequestHandler {
  return pinoHttp({
    logger: log,
    genReqId: (req) => (req as unknown as { sorovId: string }).sorovId,
    customAttributeKeys: { reqId: "sorovId", responseTime: "ms" },
    // req.log (va AsyncLocalStorage'dagi) child logger'ga faqat sorovId bog'lanadi — har qatorga butun req yozilmasin
    quietReqLogger: true,
    // 4xx — warn, 5xx — error (xato ishlovchi o'zi ham yozadi), qolgani info
    customLogLevel: (_req, res, xato) => (xato !== undefined || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    // req.url — router ichida qisqaradi ("/"), originalUrl — to'liq yo'l
    customSuccessMessage: (req, res) => `${req.method} ${asliYol(req)} ${String(res.statusCode)}`,
    customErrorMessage: (req, res) => `${req.method} ${asliYol(req)} ${String(res.statusCode)}`,
    serializers: {
      // to'liq sarlavhalar o'rniga keraklilari (hajm va maxfiylik)
      req: (req: { method: string; url: string; raw?: { originalUrl?: string }; headers: Record<string, string | undefined>; remoteAddress?: string }) => ({
        method: req.method,
        url: req.raw?.originalUrl ?? req.url,
        ip: req.remoteAddress,
        userAgent: req.headers["user-agent"],
      }),
      res: (res: { statusCode: number }) => ({ status: res.statusCode }),
    },
  });
}
