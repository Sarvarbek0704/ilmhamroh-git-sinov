// config.ts — muhit o'zgaruvchilaridan TIPLI va MUZLATILGAN config obyekti. Fail-fast: noto'g'ri sozlama bilan ilova ishga TUSHMAYDI.
// process.env faqat shu faylda o'qiladi — qolgan kod config'ni parametr sifatida oladi (testda boshqa qiymat berish oson)
import { z } from "zod";

const Rost = z.enum(["true", "false"]).transform((x) => x === "true");

/**
 * Butun son o'zgaruvchisi. z.coerce.number() EMAS: Number("") === 0 — `PORT=` (bo'sh qiymat) jim 0 bo'lib, server tasodifiy portda
 * ishga tushardi, `PG_STATEMENT_TIMEOUT=` esa timeout'ni o'chirardi (27-qism holat 19, 25-qism mashqi bo'lgan teshik). Faqat raqamlar.
 */
const Butun = (sukut: number) =>
  z.string().regex(/^\d+$/, { error: "butun son bo'lishi kerak (bo'sh qiymat — xato)" }).default(String(sukut)).transform(Number);

/**
 * CORS origin: sxema + host (+ port). `https://login.github.io/` (oxirida /) URL sifatida yaroqli, lekin brauzer Origin sarlavhasida
 * `/` yo'q — cors() satrlarni aynan solishtiradi va Access-Control-Allow-Origin chiqmaydi (25-qism mashqi bo'lgan teshik). Shuning uchun
 * URL.origin ga normallanadi; yo'l, query yoki hash bo'lsa — rad etiladi (origin emas).
 */
const Origin = z.url({ error: "CORS_ORIGINS — vergul bilan ajratilgan URL'lar (https://login.github.io)" }).transform((x, ctx) => {
  const u = new URL(x);
  if (u.pathname !== "/" || u.search !== "" || u.hash !== "") {
    ctx.issues.push({ code: "custom", input: x, message: "CORS_ORIGINS elementi faqat origin bo'lsin (yo'l, ?, # siz)" });
    return z.NEVER;
  }
  return u.origin;
});

const EnvSxemasi = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: Butun(3000).pipe(z.number().max(65_535)),
    // Sukut — faqat lokal: reverse proxy orqasida Node porti tashqariga ochilmasin (#08)
    HOST: z.string().min(1).default("127.0.0.1"),
    CORS_ORIGINS: z
      .string()
      .default("")
      .transform((x) => x.split(",").map((o) => o.trim()).filter((o) => o !== ""))
      .pipe(z.array(Origin)),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    // postgres — node-postgres (PgOmbori, 26); prisma — Prisma 7 (PrismaOmbori, 27). Ikkalasi bir xil sxema va shartnoma testlari
    SAQLASH: z.enum(["xotira", "fayl", "postgres", "prisma"]).default("xotira"),
    /** SAQLASH=postgres: ulanish satri (26-qism). Lokal kanon: postgres://postgres@127.0.0.1:5499/vazifalar */
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "DATABASE_URL — postgres://foydalanuvchi@host:port/baza" }).optional(),
    /** DEV rejim (SAQLASH=xotira/fayl, auth yo'q): API qaysi foydalanuvchi nomidan ishlaydi. postgres/prisma — egasi sessiyadan (28-qism #07) */
    EGASI_ID: Butun(1).pipe(z.number().positive()),
    /** Sessiya: bo'sh turish chegarasi (daqiqa, sukut 7 kun) va mutlaq muddat (kun) — #07 */
    SESSIYA_IDLE_DAQIQA: Butun(10_080).pipe(z.number().min(5).max(525_600)),
    SESSIYA_MUDDAT_KUN: Butun(30).pipe(z.number().min(1).max(400)),
    /** "Meni eslab qol" belgilanmagan sessiya (#11): idle (daqiqa, sukut 12 soat) va mutlaq (kun, sukut 7); cookie Expires'siz */
    SESSIYA_QISQA_IDLE_DAQIQA: Butun(720).pipe(z.number().min(5).max(525_600)),
    SESSIYA_QISQA_MUDDAT_KUN: Butun(7).pipe(z.number().min(1).max(400)),
    /** Secure cookie va __Host- prefiksi (sukut true: Chromium http://localhost da ham qabul qiladi — t06). LAN IP / http domen orqali sinashda false */
    COOKIE_SECURE: Rost.default(true),
    /**
     * #15: ilova siri (≥ 32 belgi) — undan HKDF bilan alohida kalitlar: SMS kod HMAC (#13), OIDC cookie imzosi, kursor (#20), API kalit (#22).
     * Berilmasa — har ishga tushishda tasodifiy (dev: qayta ishga tushsa kodlar, kursorlar yaroqsiz). Hosil qilish: node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
     */
    ILOVA_SIRI: z.string().min(32, { error: "ILOVA_SIRI kamida 32 belgi" }).optional(),
    /** SMS faqat shu prefiksli raqamlarga (SMS pumping — #30). Vergul bilan: "+998,+7" */
    OTP_MAMLAKATLAR: z.string().default("+998").transform((x) => x.split(",").map((m) => m.trim()).filter((m) => m !== ""))
      .pipe(z.array(z.string().regex(/^\+\d{1,4}$/, { error: "OTP_MAMLAKATLAR — +998 kabi prefikslar" })).min(1)),
    /** #20: auth pool ulanishi (vazifalar_auth roli). Berilmasa — DATABASE_URL (lokal dev). Production: DATABASE_URL — vazifalar_api, bu — vazifalar_auth */
    AUTH_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "AUTH_DATABASE_URL — postgres://vazifalar_auth@host:port/baza" }).optional(),
    /** #22: servislararo HMAC siri (bot → API), ≥ 32 belgi; berilsa /v1/ichki/* yoqiladi */
    ICHKI_HMAC_SIRI: z.string().min(32, { error: "ICHKI_HMAC_SIRI kamida 32 belgi" }).optional(),
    /** #15: API'ning tashqi manzili (OIDC redirect URI: <API_URL>/v1/auth/oidc/google/qaytish — provayderda AYNAN shu ro'yxatdan o'tadi) */
    API_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000").transform((x) => x.replace(/\/+$/, "")),
    /** #15: Google OIDC (console.cloud.google.com → Credentials → OAuth client ID, "Web application"). Ikkalasi berilsa — /v1/auth/oidc/google yoqiladi */
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    /** issuer — sukut Google; testda lokal soxta provayder */
    GOOGLE_ISSUER: z.url().default("https://accounts.google.com"),
    /** faqat dev/test: http issuer (lokal oidc-provider) */
    OIDC_HTTP: Rost.default(false),
    /** #16: Telegram Login Widget bot tokeni (BotFather; .env — git'ga emas). Berilmasa /v1/auth/telegram yo'llari 404 */
    TELEGRAM_BOT_TOKEN: z.string().regex(/^\d{5,15}:[\w-]{30,60}$/, { error: "TELEGRAM_BOT_TOKEN — 123456:ABC… ko'rinishida" }).optional(),
    /** auth_date maksimal yoshi (s) — sukut 1 kun */
    TELEGRAM_AUTH_MUDDAT_S: Butun(86_400).pipe(z.number().min(60).max(604_800)),
    /** #19: WebAuthn — RP ID (domen, port'siz; lokal — localhost) va sahifa origin'lari (sukut — ILOVA_URL) */
    WEBAUTHN_RP_ID: z.string().regex(/^[a-z0-9.-]+$/).default("localhost"),
    WEBAUTHN_ORIGINLAR: z.string().optional(),
    /** #30: Cloudflare Turnstile sir kaliti (dashboard → Turnstile). Berilsa — /royxat, /parol-tiklash/sorov, /otp/yubor da X-Captcha talab qilinadi.
     * Rasmiy test kalitlari: 1x0000000000000000000000000000000AA (doim o'tadi), 2x…AA (doim rad) — t30 */
    TURNSTILE_SIRI: z.string().min(10).optional(),
    /** Turnstile javobidagi hostname (sayt domeni) — boshqa saytda olingan tokenni rad etish uchun; test kaliti "example.com" qaytaradi */
    TURNSTILE_HOSTNAME: z.string().optional(),
    /** #30: butun ilova bo'yicha kunlik SMS chegarasi */
    SMS_KUNLIK_MAKS: Butun(1000).pipe(z.number().min(1)),
    /** Frontend manzili — xatdagi havolalar (#12): <ILOVA_URL>/tasdiqlash#token=… */
    ILOVA_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:5173").transform((x) => x.replace(/\/+$/, "")),
    /** pool hajmi (#44): bitta jarayon uchun; N instans × PG_POOL_MAX < max_connections */
    PG_POOL_MAX: Butun(10).pipe(z.number().min(1).max(100)),
    /** bitta so'rov chegarasi (ms) — osilib qolgan so'rov ulanishni band qilmasin */
    PG_STATEMENT_TIMEOUT: Butun(5000),
    FAYL_YOLI: z.string().min(1).default("data/vazifalar.json"),
    /** Redis kesh (holat 58, ixtiyoriy): berilsa postgres/prisma ombori ustiga KeshliOmbor. Lokal: redis://127.0.0.1:6380 */
    REDIS_URL: z.url({ protocol: /^rediss?$/, error: "REDIS_URL — redis://host:port" }).optional(),
    /** kesh yashash vaqti (s) — yozuvlar avlod bilan darhol ko'rinadi; TTL faqat eski kalitlarni tozalaydi va tashqi yozuvlar uchun chegara */
    KESH_TTL: Butun(60).pipe(z.number().min(1).max(86_400)),
    // Express "trust proxy": false | true | proxy'lar soni | "loopback" (t08)
    TRUST_PROXY: z
      .string()
      .default("false")
      .transform((x): boolean | number | string => (x === "true" ? true : x === "false" ? false : /^\d+$/.test(x) ? Number(x) : x)),
    /** foydalanuvchiga ko'rsatiladigan sana uchun mintaqa; saqlash — doim UTC */
    APP_TZ: z.string().default("Asia/Tashkent").refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", { error: "APP_TZ — IANA mintaqa (Asia/Tashkent)" }),
    /** vazifa bajarilganda POST yuboriladigan manzil (ixtiyoriy, #49) */
    // 29-qism B (holat 06): fayl ilovalari — S3 mos ombor (lokal MinIO). S3_BUCKET berilsa qolganlari majburiy (pastdagi refine)
    S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
    S3_REGION: z.string().min(1).default("us-east-1"),
    S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, { error: "S3_BUCKET — kichik harf, raqam, nuqta, chiziqcha (3–63)" }).optional(),
    S3_KALIT: z.string().min(1).optional(),
    S3_SIR: z.string().min(8).optional(),
    // 29-qism B (holat 13): SMTP — berilsa 28 oqimlari xatni shu orqali yuboradi (lokal: Mailpit 127.0.0.1:4425); berilmasa — LogPochtachi (dev)
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: Butun(587).pipe(z.number().int().min(1).max(65535)),
    /** true — 465 (implicit TLS); false — 587 STARTTLS (production'da requireTLS) yoki lokal Mailpit */
    SMTP_SECURE: Rost.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    SMTP_FROM: z.string().min(3).default("vazifalar <noreply@localhost>"),
    // 29-qism B (holat 18): Web Push (VAPID: npx web-push generate-vapid-keys) va SMS provayderi (Eskiz; lokal — soxta server). Berilmasa — kanal yo'q / OTP log'ga
    VAPID_OCHIQ: z.string().regex(/^[A-Za-z0-9_-]{87}$/, { error: "VAPID_OCHIQ — 65 bayt base64url" }).optional(),
    VAPID_YOPIQ: z.string().regex(/^[A-Za-z0-9_-]{43}$/, { error: "VAPID_YOPIQ — 32 bayt base64url" }).optional(),
    VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/).default("mailto:admin@vazifalar.example.uz"),
    ESKIZ_URL: z.url({ protocol: /^https?$/ }).optional(),
    ESKIZ_EMAIL: z.string().min(3).optional(),
    ESKIZ_PAROL: z.string().min(1).optional(),
    ESKIZ_FROM: z.string().min(1).default("4546"),
    // 29-qism B (holat 22): bot — username (deep link havolasi), soxta Bot API manzili (lokal sinov), fon jarayonlari roli (205: vazifalar_ishchi)
    TELEGRAM_BOT_NOMI: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{3,31}$/, { error: "TELEGRAM_BOT_NOMI — bot username (@ siz)" }).optional(),
    TELEGRAM_API_ROOT: z.url({ protocol: /^https?$/ }).optional(),
    ISHCHI_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
    FAYL_MAKS_MB: Butun(10).pipe(z.number().min(1).max(10)), // 201-fayllar.sql CHECK: hajm ≤ 10 MB
    HSTS: Rost.default(false),
    /** 31 #26: SIGTERM dan keyin server.close() gacha kutish (ms) — shu orada /health/ready 503; prod (k8s/LB): readiness oralig'idan katta (masalan 5000) */
    YOPISH_KECHIKISH_MS: Butun(0).pipe(z.number().max(60_000)),
    /** 31 #28: /metrics uchun Bearer token (berilmasa — kirishsiz; faqat ichki tarmoqda!) */
    METRIKA_TOKEN: z.string().min(16).optional(),
    // ─── 31-qism: AI (#13–#21) ───
    /** LLM provayderi. "yoq" — AI yo'llari o'chiq (404). gemini — sinalgan; openai (OpenAI-mos: OpenAI, Groq, OpenRouter, Ollama) va anthropic — SINALMAGAN (kalit yo'q) */
    AI_PROVAYDER: z.enum(["yoq", "gemini", "openai", "anthropic"]).default("yoq"),
    /** kalitlar — faqat muhitdan (.env, git'ga EMAS); qiymat hech qachon loglanmaydi */
    GEMINI_API_KEY: z.string().min(10).optional(),
    OPENAI_API_KEY: z.string().min(10).optional(),
    ANTHROPIC_API_KEY: z.string().min(10).optional(),
    /** OpenAI-mos provayder manzili (Groq: https://api.groq.com/openai/v1, Ollama: http://127.0.0.1:11434/v1) */
    AI_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
    /** matn modeli; sukut — provayderga qarab (gemini: gemini-3.5-flash-lite). Zaxira — 429/5xx/timeout'da bitta qayta urinish shu model bilan (#16) */
    AI_MODEL: z.string().min(1).optional(),
    AI_ZAXIRA_MODEL: z.string().min(1).optional(),
    /** embedding modeli va o'lchami (sql/302: vector(768) — o'lcham o'zgarsa migratsiya kerak) */
    AI_EMBEDDING_MODEL: z.string().min(1).default("gemini-embedding-2"),
    /** bitta LLM chaqiruvi chegarasi (ms) va qayta urinishlar (#29) */
    AI_TIMEOUT_MS: Butun(20_000).pipe(z.number().min(1000).max(120_000)),
    AI_QAYTA_URINISH: Butun(2).pipe(z.number().min(0).max(5)),
    /** 32 #01: bitta AI so'rovining UMUMIY muddati — retry, backoff va zaxira model shu ichida (asoslash — ai.module.ts AI_DEADLINE_SUKUT) */
    AI_DEADLINE_MS: Butun(25_000).pipe(z.number().min(1000).max(120_000)),
    /** #19: foydalanuvchi kunlik kvotasi (Asia/Tashkent kuni) — so'rovlar va tokenlar */
    AI_KUNLIK_SOROV: Butun(30).pipe(z.number().min(1).max(10_000)),
    AI_KUNLIK_TOKEN: Butun(60_000).pipe(z.number().min(1000).max(10_000_000)),
  })
  .refine((e) => e.NODE_ENV !== "production" || e.CORS_ORIGINS.length > 0, { error: "production'da CORS_ORIGINS majburiy", path: ["CORS_ORIGINS"] })
  // auth faqat postgres/prisma bilan: xotira/fayl — bitta foydalanuvchili DEV rejim, production'da taqiqlangan; production'da cookie faqat Secure
  .refine((e) => e.NODE_ENV !== "production" || e.SAQLASH === "postgres" || e.SAQLASH === "prisma", { error: "production'da SAQLASH=postgres yoki prisma (auth) bo'lishi kerak", path: ["SAQLASH"] })
  // 28-qism: xat faqat log'ga yozilardi (havola — parolni tiklash kaliti), production yopiq edi. 29-qism B (holat 13): SMTP berilsa production ochiladi
  .refine((e) => e.NODE_ENV !== "production" || e.SMTP_HOST !== undefined, { error: "production'da SMTP_HOST majburiy: aks holda tasdiqlash/tiklash havolalari log'ga tushadi", path: ["SMTP_HOST"] })
  .refine((e) => (e.VAPID_OCHIQ === undefined) === (e.VAPID_YOPIQ === undefined), { error: "VAPID_OCHIQ va VAPID_YOPIQ birga beriladi", path: ["VAPID_YOPIQ"] })
  .refine((e) => e.ESKIZ_URL === undefined || (e.ESKIZ_EMAIL !== undefined && e.ESKIZ_PAROL !== undefined), { error: "ESKIZ_URL bilan ESKIZ_EMAIL va ESKIZ_PAROL majburiy", path: ["ESKIZ_PAROL"] })
  .refine((e) => e.TELEGRAM_BOT_NOMI === undefined || e.REDIS_URL !== undefined, { error: "TELEGRAM_BOT_NOMI uchun REDIS_URL kerak (ulash tokeni)", path: ["REDIS_URL"] })
  .refine((e) => (e.SMTP_USER === undefined) === (e.SMTP_PASS === undefined), { error: "SMTP_USER va SMTP_PASS birga beriladi", path: ["SMTP_PASS"] })
  .refine((e) => e.NODE_ENV !== "production" || e.COOKIE_SECURE, { error: "production'da COOKIE_SECURE=false mumkin emas", path: ["COOKIE_SECURE"] })
  .refine((e) => (e.GOOGLE_CLIENT_ID === undefined) === (e.GOOGLE_CLIENT_SECRET === undefined), { error: "GOOGLE_CLIENT_ID va GOOGLE_CLIENT_SECRET birga beriladi", path: ["GOOGLE_CLIENT_SECRET"] })
  // 29-qism B (holat 06): S3_BUCKET — fayl ilovalari yoqilgan; kalit, sir va (MinIO uchun) endpoint birga; fayllar faqat Postgres omborida (fayllar jadvali)
  .refine((e) => e.S3_BUCKET === undefined || (e.S3_KALIT !== undefined && e.S3_SIR !== undefined), { error: "S3_BUCKET bilan S3_KALIT va S3_SIR majburiy", path: ["S3_KALIT"] })
  .refine((e) => e.S3_BUCKET === undefined || e.SAQLASH === "postgres" || e.SAQLASH === "prisma", { error: "fayl ilovalari (S3_BUCKET) faqat SAQLASH=postgres/prisma bilan", path: ["S3_BUCKET"] })
  .refine((e) => e.AI_PROVAYDER !== "gemini" || e.GEMINI_API_KEY !== undefined, { error: "AI_PROVAYDER=gemini uchun GEMINI_API_KEY kerak", path: ["GEMINI_API_KEY"] })
  .refine((e) => e.AI_PROVAYDER !== "openai" || e.OPENAI_API_KEY !== undefined || e.AI_BASE_URL !== undefined, { error: "AI_PROVAYDER=openai uchun OPENAI_API_KEY (yoki lokal AI_BASE_URL) kerak", path: ["OPENAI_API_KEY"] })
  .refine((e) => e.AI_PROVAYDER !== "anthropic" || e.ANTHROPIC_API_KEY !== undefined, { error: "AI_PROVAYDER=anthropic uchun ANTHROPIC_API_KEY kerak", path: ["ANTHROPIC_API_KEY"] })
  .refine((e) => e.AI_PROVAYDER === "yoq" || e.AI_PROVAYDER === "gemini" || e.AI_MODEL !== undefined, { error: "openai/anthropic uchun AI_MODEL majburiy (sukut model faqat gemini uchun sinalgan)", path: ["AI_MODEL"] })
  .refine((e) => e.AI_PROVAYDER === "yoq" || e.SAQLASH === "postgres" || e.SAQLASH === "prisma", { error: "AI (kvota, embedding) faqat SAQLASH=postgres/prisma bilan", path: ["AI_PROVAYDER"] })
  .refine((e) => (e.SAQLASH !== "postgres" && e.SAQLASH !== "prisma") || e.DATABASE_URL !== undefined, { error: "SAQLASH=postgres/prisma uchun DATABASE_URL majburiy", path: ["DATABASE_URL"] });

export type Config = Readonly<z.output<typeof EnvSxemasi>>;

export class ConfigXatosi extends Error {
  constructor(xabar: string) {
    super(xabar);
    this.name = "ConfigXatosi";
  }
}

/** @param env odatda process.env; testda — oddiy obyekt */
export function configYukla(env: Record<string, string | undefined>): Config {
  const n = EnvSxemasi.safeParse(env);
  // z.prettifyError — odam o'qiydigan ro'yxat (har xato alohida qatorda, "at PORT" bilan). Qiymatlarning o'zi chiqarilmaydi (sir bo'lishi mumkin)
  if (!n.success) throw new ConfigXatosi(`Sozlama noto'g'ri:\n${z.prettifyError(n.error)}`);
  return Object.freeze(n.data);
}
