// ilova.ts — Nest ilovasi (25-qism ilova.ts ning o'rni): Express middleware'lari → Nest marshrutlari → Problem Details filtri (APP_FILTER).
// listen() YO'Q — server ishga-tushir.ts da, testlar ilovani portsiz ham ishlata oladi (supertest: app.getHttpServer()).
// Holat 30: sozlamalar DI'dagi Config'dan (ConfigModule) — parametrlar faqat testlarda ustidan yozish uchun
import { NestFactory } from "@nestjs/core";
import { VersioningType } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { join } from "node:path";
import { Logger } from "nestjs-pino";
import { ClsMiddleware, ClsService } from "nestjs-cls";
import { AppModule } from "./app.module.ts";
import { hujjatniUla } from "./hujjat.ts";
import { sorovId } from "./umumiy/sorov-id.ts";
import { XotiraIdempotentlikOmbori } from "./umumiy/idempotentlik.ts";
import type { IdempotentlikOmbori } from "./umumiy/idempotentlik.ts";
import { JSON_TURLARI } from "./umumiy/json-kerak.ts";
import { tanaXatosi } from "./umumiy/tana-xatosi.ts";
import { CLS_LOG, sorovLogi } from "./umumiy/log.ts";
import type { Log } from "./umumiy/log.ts";
import type { Xabarchi } from "./umumiy/webhook.ts";
import type { OmborFabrikasi, VazifaOmbori } from "./vazifalar/ombor.ts";
import type { Config } from "./config.ts";
import { AUTH, CLS_EGASI, CONFIG, LOG } from "./tokenlar.ts";
import type { AuthBogliqliklari } from "./auth/xizmat.ts";
import { csrfHimoya } from "./auth/csrf.ts";
import { egasiniAniqla, kimlik, KirilmaganXatosi } from "./auth/middleware.ts";
import { RuxsatYoqXatosi } from "./auth/qoriqchi.ts";
import type { IntegratsiyaSozlamasi } from "./integratsiya.module.ts";
import { jonliManba } from "./realtime/jonli.ts";
import { Metrikalar } from "./kuzatuv/metrikalar.ts";
import { navbatKuzatuv } from "./navbat/marshrut.ts";
import type { NavbatSozlamasi } from "./navbat/navbat.controller.ts";
import { NAVBATLAR } from "./tokenlar.ts";

export type Bogliqliklar = {
  /** tayyor ombor yoki foydalanuvchi bo'yicha fabrika (testlar); berilmasa — config bo'yicha OmborModule.forRootAsync() yaratadi va yopadi */
  ombor?: VazifaOmbori | OmborFabrikasi;
  /**
   * B (28-qism auth): tayyor auth bog'liqliklari (testlar). Berilmasa: SAQLASH=postgres/prisma — config'dan yaratiladi (sessiyalar, CSRF, RBAC…),
   * xotira/fayl — DEV rejim (auth yo'q, hamma so'rov EGASI_ID nomidan; production'da config bu rejimni rad etadi)
   */
  auth?: AuthBogliqliklari;
  /** DEV rejim egasi (berilmasa — config EGASI_ID) */
  egasiId?: number;
  /** #20 kursor HMAC kaliti, #22 servislararo HMAC siri — berilmasa config'dagi sirlardan */
  kursorKaliti?: Buffer;
  ichkiSir?: Buffer;
  /** tayyor config; berilmasa — process.env dan (ConfigModule, configYukla) */
  config?: Config;
  /** quyidagilar berilsa — config'dagi qiymat o'rniga (testlar) */
  corsOriginlar?: readonly string[];
  idempotentlikOmbori?: IdempotentlikOmbori;
  log?: Log;
  xabarchi?: Xabarchi;
  tz?: string;
  trustProxy?: boolean | number | string;
  hsts?: boolean;
} & IntegratsiyaSozlamasi;

export async function ilovaYarat({ ombor, auth, egasiId, kursorKaliti, ichkiSir, config, corsOriginlar, idempotentlikOmbori = new XotiraIdempotentlikOmbori(), log, xabarchi, tz, trustProxy, hsts, ...integratsiya }: Bogliqliklar): Promise<NestExpressApplication> {
  // bodyParser: false — Nest o'z JSON parser'ini qo'ymasin: biznikida limit (16 KB) va merge-patch+json turi bor.
  // abortOnError: false — provider fabrikasi yiqilsa (baza yo'q, EGASI_ID yo'q, config xato) Nest process.exit(1) QILMASIN, xato Promise orqali chiqsin.
  // bufferLogs — Nest tizim loglari pino Logger ulangunicha yig'iladi (#29)
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot({ ombor, auth, config, log, xabarchi, tz, idempotentlikOmbori, kursorKaliti, ichkiSir, integratsiya }), { bodyParser: false, bufferLogs: true, abortOnError: false });
  app.useLogger(app.get(Logger));
  const c = app.get<Config>(CONFIG);
  const l = app.get<Log>(LOG);
  const a = app.get<AuthBogliqliklari | null>(AUTH);
  const cls = app.get(ClsService);
  const originlar = [...(corsOriginlar ?? c.CORS_ORIGINS)];
  app.set("trust proxy", trustProxy ?? c.TRUST_PROXY);
  app.disable("x-powered-by"); // "Express" ekanini oshkor qilmaymiz
  // app.use() — Express middleware'lari, Nest marshrutlaridan OLDIN, shu tartibda (25-qism ilova.ts bilan bir xil)
  // 31 #28: Prometheus RED metrikalari (marshrut shabloni bo'yicha) va /metrics — Nest guard'laridan tashqarida (METRIKA_TOKEN bilan himoya)
  const metrikalar = new Metrikalar(c.NODE_ENV !== "test");
  app.use(metrikalar.middleware());
  app.use("/metrics", (req: Request, res: Response, keyingi: NextFunction) => { if (req.method !== "GET") { keyingi(); return; } void metrikalar.handler(c.METRIKA_TOKEN)(req, res); });
  app.use(sorovId());
  // so'rov logi (pino-http) — keyin CLS konteksti: req.log "log" kalitiga — xizmat, filtr, fon ishi joriyLog() bilan sorovId'li logger oladi
  app.use(sorovLogi(l));
  app.use(new ClsMiddleware({ generateId: true, idGenerator: (req: express.Request) => req.sorovId, setup: (cls, req: express.Request) => { cls.set(CLS_LOG, req.log); } }).use);
  // helmet (28 #24): API — JSON, sahifa emas: default-src 'none', iframe'ga qo'yib bo'lmaydi, CORP same-site. HSTS — faqat HTTPS orqasida, 1 yil.
  // /docs (Swagger UI — HTML, skript, uslub) — o'z sahifasi uchun helmet'ning sukut CSP'si ('self'); boshqa hamma yo'l — qat'iy
  const hstsYoq = (hsts ?? c.HSTS) ? { maxAge: 31_536_000, includeSubDomains: true } : false;
  const qatiy = helmet({
    contentSecurityPolicy: { useDefaults: false, directives: { "default-src": ["'none'"], "base-uri": ["'none'"], "form-action": ["'none'"], "frame-ancestors": ["'none'"] } },
    xFrameOptions: { action: "deny" },
    crossOriginResourcePolicy: { policy: "same-site" },
    strictTransportSecurity: hstsYoq,
  });
  const hujjatUchun = helmet({ xFrameOptions: { action: "deny" }, crossOriginResourcePolicy: { policy: "same-site" }, strictTransportSecurity: hstsYoq });
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    (req.path === "/docs" || req.path.startsWith("/docs/") ? hujjatUchun : qatiy)(req, res, next);
  });
  // Permissions-Policy — helmet qo'ymaydi: API sahifasi kamera, mikrofon, joylashuvga murojaat qila olmasin
  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => { res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()"); next(); });
  // CORS (28 #25): aniq origin'lar + credentials (cookie sessiyasi bilan boshqa origin'dagi frontend); "*" + credentials — brauzer rad etadi (e2e)
  app.use(
    cors({
      origin: originlar,
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-Id", "If-Match", "If-None-Match", "X-Captcha"],
      exposedHeaders: ["Location", "X-Request-Id", "Idempotency-Replayed", "ETag", "Link", "Deprecation", "Sunset"],
      maxAge: 600,
    }),
  );
  app.useStaticAssets(join(import.meta.dirname, "..", "public"));
  // verify: xom baytlar — #22 servislararo HMAC imzosi aynan yuborilgan baytlar ustida
  app.use(express.json({ limit: "16kb", type: JSON_TURLARI, verify: (req, _res, buf) => { (req as express.Request).xomTana = buf; } }));
  app.use(tanaXatosi);
  // B: kim so'rayapti — Nest guard'laridan OLDIN (Express middleware): CSRF (#10, cookie + o'zgartiruvchi so'rov — faqat o'z/CORS origin'idan),
  // kimlik (cookie sessiyasi yoki Bearer API kaliti), egasi (req.egasi + CLS — xizmatlar ombor tanlaydi; idempotentlik kaliti egasi bo'yicha).
  // Ruxsat (401/403, @Ochiq, @Rollar) — global KirishGuard. auth/admin javoblari keshlanmaydi (28: r.use no-store)
  if (a !== null) {
    app.use(csrfHimoya(originlar));
    app.use(kimlik(a.sessiyalar, a.apiKalitlar));
    app.use(["/v1/auth", "/v1/admin"], (_req: express.Request, res: express.Response, next: express.NextFunction) => { res.set("Cache-Control", "no-store"); next(); });
  }
  app.use(egasiniAniqla(a === null ? (egasiId ?? c.EGASI_ID) : undefined, (e) => { cls.set(CLS_EGASI, e); }));
  // C (29-qism holat 38/50): X-Jonli-Manba — so'rov kontekstiga (outbox hodisasi o'z oynasini belgilaydi; 19-qism mijozi o'z hodisasini tashlaydi)
  app.use(jonliManba);
  // C: urlencoded tana — faqat ikki yo'lda: RFC 8058 one-click obuna (pochta provayderi forma yuboradi) va Eskiz SMS callback'i
  app.use(["/v1/obuna", "/v1/sms"], express.urlencoded({ extended: false, limit: "4kb" }));
  // C (29 holat 45, #47): Bull Board — Express adapteri o'z Router'ini beradi (Nest controller emas), shuning uchun himoya ham shu yerda:
  // 28 admin roli (sessiya bilan; API kaliti — yo'q). Navbatdagi ish ma'lumoti (foydalanuvchi id, email) — maxfiy
  const navbat = app.get<NavbatSozlamasi | null>(NAVBATLAR);
  if (navbat !== null && a !== null) {
    app.use("/v1/admin/navbat", (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      if (req.sessiya === undefined || req.apiKalit !== undefined) throw new KirilmaganXatosi();
      if (req.sessiya.rol !== "admin") throw new RuxsatYoqXatosi();
      next();
    }, navbatKuzatuv(navbat.navbatlar, "/v1/admin/navbat"));
  }
  // Idempotency-Key va eskirgan yo'l sarlavhalari — Nest middleware'lari (VazifalarModule/AppModule.configure, #21); Problem Details — APP_FILTER (#24/#26)
  // Versiya URI'da: /v1/... ; versiyasiz eski yo'l (VERSION_NEUTRAL) — FAQAT vazifalar/teglar controller'larida (28 #07: yashirin yo'llar yo'q)
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  // OpenAPI: /docs (UI), /docs-json (#44)
  hujjatniUla(app);
  await app.init();
  return app;
}
