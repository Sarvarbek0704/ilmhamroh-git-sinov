// sir.ts — #15 (holat 15): bitta ilova siri (ILOVA_SIRI) dan har vazifa uchun ALOHIDA kalit — HKDF (RFC 5869, node:crypto hkdfSync).
// Nega alohida: OTP HMAC kaliti sizsa ham kursor yoki OIDC cookie imzosi soxtalashtirilmasin (bir kalit — bir maqsad). Yangi maqsad — yangi "info" satri.
import { hkdfSync, randomBytes } from "node:crypto";

export type KalitMaqsadi = "otp" | "oidc-cookie" | "kursor" | "telegram" | "api-kalit" | "totp" | "zaxira-kod" | "mfa-cookie" | "webauthn-cookie"
  // 29-qism B: obuna (holat 13, one-click obunadan chiqish), sms (holat 18, callback id imzosi), telegram-ulash (holat 22, deep link)
  | "obuna" | "sms" | "telegram-ulash";

export class Sirlar {
  readonly #asos: Buffer;
  /** true — ILOVA_SIRI berilmagan, jarayon ichida tasodifiy (dev: qayta ishga tushsa kodlar, kursorlar, OIDC cookie'lar yaroqsiz) */
  readonly vaqtinchalik: boolean;

  /** @param siri ILOVA_SIRI (≥ 32 belgi) yoki undefined */
  constructor(siri?: string) {
    this.vaqtinchalik = siri === undefined;
    this.#asos = siri === undefined ? randomBytes(32) : Buffer.from(siri, "utf8");
    if (this.#asos.length < 32) throw new Error("ILOVA_SIRI kamida 32 bayt bo'lsin");
  }

  kalit(maqsad: KalitMaqsadi): Buffer {
    return Buffer.from(hkdfSync("sha256", this.#asos, "vazifalar-api", maqsad, 32));
  }
}
