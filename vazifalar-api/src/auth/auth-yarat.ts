// auth-yarat.ts — 28-qism server.ts dagi authYarat() — config'dan auth bog'liqliklari (sessiyalar, tokenlar, OTP, MFA, OIDC, API kalitlar, cheklagich,
// CAPTCHA). Nest'da AUTH provider fabrikasi shuni chaqiradi (auth.module.ts). Mantiq o'zgarmadi.
// 30 C (29-qism B holat 13/18): pochtachi — SMTP (POCHTA provider'i, Mailpit) yoki log; OTP SMS — Eskiz (ESKIZ_* berilsa) yoki log.
import type pg from "pg";
import type { Config } from "../config.ts";
import { joriyLog } from "../umumiy/log.ts";
import type { Log } from "../umumiy/log.ts";
import { AuthOmbori } from "./ombor.ts";
import { SessiyaOmbori } from "./sessiya.ts";
import { BirMartalikTokenlar } from "./token.ts";
import { LogPochtachi } from "./pochta.ts";
import type { Pochtachi } from "./pochta.ts";
import type { Pochta } from "../email/pochta.ts";
import { SmtpPochtachi } from "../email/smtp-pochtachi.ts";
import { EskizProvayder } from "../sms/sms.ts";
import { ProvayderSms } from "../sms/ulash.ts";
import { FonIshlar } from "../umumiy/fon.ts";
import { LogSms, OtpOmbori } from "./otp.ts";
import type { Sirlar } from "../umumiy/sir.ts";
import { Oidc } from "./oidc.ts";
import { MfaOmbori } from "./mfa.ts";
import { ImzoliCookie } from "./imzo-cookie.ts";
import { ApiKalitlar } from "./api-kalit.ts";
import { PgCheklagich, RedisCheklagich } from "../umumiy/cheklov.ts";
import type { CheklovRedis } from "../umumiy/cheklov.ts";
import { Turnstile } from "./captcha.ts";
import type { AuthBogliqliklari } from "./xizmat.ts";

export function authYarat(pool: pg.Pool, config: Config, sirlar: Sirlar, log: Log, pochta: Pochta | null = null, redis?: CheklovRedis): AuthBogliqliklari {
  const pochtachi: Pochtachi = pochta === null ? new LogPochtachi(() => joriyLog(log)) : new SmtpPochtachi(pochta);
  return {
    pool,
    ombor: new AuthOmbori(pool),
    tokenlar: new BirMartalikTokenlar(pool),
    pochtachi,
    ilovaUrl: config.ILOVA_URL,
    // Fon ishlari (xatlar): ilova yopilganda tugashi kutiladi (AuthYopuvchi) — yarim yuborilgan xat yo'qolmasin
    fon: new FonIshlar(() => joriyLog(log)),
    otp: new OtpOmbori(pool, sirlar.kalit("otp")),
    sms: config.ESKIZ_URL === undefined || config.ESKIZ_EMAIL === undefined || config.ESKIZ_PAROL === undefined ? new LogSms(() => joriyLog(log))
      : new ProvayderSms(new EskizProvayder({ baseUrl: config.ESKIZ_URL, email: config.ESKIZ_EMAIL, parol: config.ESKIZ_PAROL, from: config.ESKIZ_FROM })),
    otpMamlakatlar: config.OTP_MAMLAKATLAR,
    mfa: {
      ombor: new MfaOmbori(pool, sirlar.kalit("totp"), sirlar.kalit("zaxira-kod")),
      kutish: new ImzoliCookie("mfa", sirlar.kalit("mfa-cookie"), 5 * 60_000, config.COOKIE_SECURE),
      chaqiriq: new ImzoliCookie("webauthn", sirlar.kalit("webauthn-cookie"), 5 * 60_000, config.COOKIE_SECURE),
      rpId: config.WEBAUTHN_RP_ID,
      originlar: config.WEBAUTHN_ORIGINLAR?.split(",").map((x) => x.trim()) ?? [new URL(config.ILOVA_URL).origin],
    },
    telegram: config.TELEGRAM_BOT_TOKEN === undefined ? undefined : { botToken: config.TELEGRAM_BOT_TOKEN, maksS: config.TELEGRAM_AUTH_MUDDAT_S },
    oidc: new Map(config.GOOGLE_CLIENT_ID === undefined || config.GOOGLE_CLIENT_SECRET === undefined ? [] : [["google", new Oidc({
      nom: "google", issuer: config.GOOGLE_ISSUER, clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET,
      qaytishUrl: `${config.API_URL}/v1/auth/oidc/google/qaytish`, httpRuxsat: config.OIDC_HTTP,
    }, sirlar.kalit("oidc-cookie"), config.COOKIE_SECURE)]]),
    apiKalitlar: new ApiKalitlar(pool, sirlar.kalit("api-kalit")),
    // 31 #30: REDIS_URL bo'lsa — Redis cheklagichi (issiq qator yo'q); aks holda Postgres (28-qism)
    cheklagich: redis === undefined ? new PgCheklagich(pool) : new RedisCheklagich(redis),
    captcha: config.TURNSTILE_SIRI === undefined ? undefined
      : new Turnstile(config.TURNSTILE_SIRI, config.TURNSTILE_HOSTNAME === undefined ? {} : { hostname: config.TURNSTILE_HOSTNAME }),
    smsKunlikMaks: config.SMS_KUNLIK_MAKS,
    sessiyalar: new SessiyaOmbori(pool, {
      idleMs: config.SESSIYA_IDLE_DAQIQA * 60_000, muddatMs: config.SESSIYA_MUDDAT_KUN * 86_400_000,
      qisqaIdleMs: config.SESSIYA_QISQA_IDLE_DAQIQA * 60_000, qisqaMuddatMs: config.SESSIYA_QISQA_MUDDAT_KUN * 86_400_000, secure: config.COOKIE_SECURE,
    }),
  };
}
