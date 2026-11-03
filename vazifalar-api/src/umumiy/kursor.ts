// kursor.ts — shaffof bo'lmagan (opaque) kursor: base64url(JSON) + "." + HMAC-SHA256 imzo (28-qism #20; 25-qism qarori — "imzolash 28-qismda").
// Imzo (saralash + filtr) kursor bilan birga — boshqa saralash yoki filtr bilan ishlatilsa rad etiladi. HMAC — mijoz kursor ichini O'ZGARTIRA olmaydi
// (qiymatlar baribir SQL parametri — injection emas; lekin soxta kursor bilan "o'zingiz yasagan" keyset holatlari, kelajakda kursorga qo'shiladigan
// maydonlar — masalan egasi — himoyalangan). Kalit — ILOVA_SIRI dan HKDF ("kursor"); berilmasa — jarayon ichida tasodifiy (dev/test).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { KursorQiymati } from "../vazifalar/ombor.ts";

type Ichki = { v: KursorQiymati; i: string };

const SUKUT_KALIT = randomBytes(32);

const imzola = (t: string, kalit: Buffer): Buffer => createHmac("sha256", kalit).update(t).digest().subarray(0, 16); // 128 bit yetarli, kursor qisqa

export function kursorYoz(qiymatlar: KursorQiymati, imzo: string, kalit: Buffer = SUKUT_KALIT): string {
  const t = Buffer.from(JSON.stringify({ v: qiymatlar, i: imzo } satisfies Ichki)).toString("base64url");
  return `${t}.${imzola(t, kalit).toString("base64url")}`;
}

function qiymatmi(x: unknown): x is string | number | boolean {
  return typeof x === "string" || typeof x === "number" || typeof x === "boolean";
}

/** @returns undefined — kursor buzilgan, imzosi noto'g'ri yoki boshqa so'rovniki */
export function kursorOqi(kursor: string, imzo: string, kalit: Buffer = SUKUT_KALIT): KursorQiymati | undefined {
  const m = /^([\w-]{1,1000})\.([\w-]{22})$/.exec(kursor);
  if (m === null) return undefined;
  const [, t = "", hmac = ""] = m;
  const berilgan = Buffer.from(hmac, "base64url");
  const kutilgan = imzola(t, kalit);
  if (berilgan.length !== kutilgan.length || !timingSafeEqual(berilgan, kutilgan)) return undefined;
  let ichki: unknown;
  try {
    ichki = JSON.parse(Buffer.from(t, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof ichki !== "object" || ichki === null || !("v" in ichki) || !("i" in ichki)) return undefined;
  const { v, i } = ichki;
  if (i !== imzo || !Array.isArray(v) || !v.every(qiymatmi)) return undefined;
  return v;
}
