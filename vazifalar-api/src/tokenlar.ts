// tokenlar.ts — DI tokenlari: interfeys (VazifaOmbori) va oddiy qiymatlar (log, sozlamalar) uchun. TS interfeysi ish vaqtida YO'Q —
// Nest uni constructor turidan taniy olmaydi, shuning uchun Symbol token + @Inject(TOKEN) (#08–#09)
export const VAZIFA_OMBORI = Symbol("VAZIFA_OMBORI");
export const LOG = Symbol("LOG");
export const IDEMPOTENTLIK_OMBORI = Symbol("IDEMPOTENTLIK_OMBORI");
export const XABARCHI = Symbol("XABARCHI");
export const ILOVA_SOZLAMALARI = Symbol("ILOVA_SOZLAMALARI");
/** to'liq, tekshirilgan Config (holat 30 da @nestjs/config bilan almashadi) */
export const CONFIG = Symbol("CONFIG");

/** Controller'larga kerakli kichik sozlamalar */
export type IlovaSozlamalari = { tz: string };

// ─── B bosqich (28-qism auth) ───
/** AuthBogliqliklari | null — null: DEV rejim (xotira/fayl ombori, auth yo'q, hamma so'rov EGASI_ID nomidan) */
export const AUTH = Symbol("AUTH");
/** OmborFabrikasi: foydalanuvchi id → uning ombori (VAZIFA_OMBORI o'rniga — har so'rov o'z egasi bilan) */
export const OMBOR_FABRIKASI = Symbol("OMBOR_FABRIKASI");
/** kursor HMAC kaliti (ILOVA_SIRI → HKDF "kursor") — Buffer */
export const KURSOR_KALITI = Symbol("KURSOR_KALITI");
/** CLS kaliti: joriy so'rov egasi (foydalanuvchi id) — kimlik middleware'i qo'yadi, xizmatlar oladi */
export const CLS_EGASI = "egasi";
/** #22: servislararo HMAC siri (ICHKI_HMAC_SIRI) — Buffer | null; null — /v1/ichki/* yo'q (404) */
export const ICHKI_SIR = Symbol("ICHKI_SIR");
/** ILOVA_SIRI dan HKDF kalitlari (Sirlar) */
export const SIRLAR = Symbol("SIRLAR");
/** C bosqich (29-qism integratsiyalari): har biri null — o'chiq (29 dagi "berilmasa yo'llar yo'q"); controller'lar faqat yoqilganda ro'yxatdan o'tadi */
export const FAYLLAR = Symbol("FAYLLAR");
export const BILDIRISHNOMA = Symbol("BILDIRISHNOMA");
export const OBUNA_KALITI = Symbol("OBUNA_KALITI");
export const TELEGRAM_ULASH = Symbol("TELEGRAM_ULASH");
export const WEBHOOKLAR = Symbol("WEBHOOKLAR");
export const JONLI = Symbol("JONLI");
export const NAVBATLAR = Symbol("NAVBATLAR");
/** C: SMTP pochta (Nodemailer) yoki null — SMTP_HOST berilmagan (dev: LogPochtachi) */
export const POCHTA = Symbol("POCHTA");
// ─── 31-qism (prodakshn va AI) ───
/** #05/#09: vazifa hodisalari statistikasi — { pool } yoki null (postgres/prisma emas) */
export const STATISTIKA = Symbol("STATISTIKA");
/** #13–#21: AI xizmatlari (AiXizmatlari) yoki null — AI_PROVAYDER=yoq */
export const AI = Symbol("AI");
/** #25: BayroqlarXizmati yoki null (auth yo'q — cheklovsiz) */
export const BAYROQLAR = Symbol("BAYROQLAR");
/** #26/#27: jarayon holati (IlovaHolati) — yopilish boshlanganini readiness biladi */
export const ILOVA_HOLATI = Symbol("ILOVA_HOLATI");
export class IlovaHolati {
  /** ishga tushish tugadi (listen) — /health/startup */
  boshlandi = false;
  /** SIGTERM keldi — /health/ready 503, yangi trafik kelmasin */
  yopilmoqda = false;
}
