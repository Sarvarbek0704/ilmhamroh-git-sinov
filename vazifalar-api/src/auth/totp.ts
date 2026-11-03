// totp.ts — #19 B-123 (holat 19): TOTP (RFC 6238 / HOTP RFC 4226) — o'zimiz, node:crypto bilan (~40 qator); RFC 6238 test vektorlari bilan sinalgan
// (test/totp.test.ts). Google Authenticator va boshqalar: SHA-1, 6 raqam, 30 s — otpauth:// URI (QR kod ichida shu).
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(b: Buffer): string {
  let bits = 0;
  let qiymat = 0;
  let s = "";
  for (const x of b) {
    qiymat = (qiymat << 8) | x;
    bits += 8;
    while (bits >= 5) {
      s += B32.charAt((qiymat >>> (bits - 5)) & 31);
      bits -= 5;
    }
    qiymat &= (1 << bits) - 1; // ishlatilgan bitlarni tashlaymiz — << 32 bitdan oshmasin
  }
  if (bits > 0) s += B32.charAt((qiymat << (5 - bits)) & 31);
  return s;
}

/** HOTP (RFC 4226): HMAC(siri, 8 baytlik hisoblagich) → dinamik qisqartirish → `raqam` ta raqam */
export function hotp(siri: Buffer, hisoblagich: bigint, raqam = 6, alg: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const h = Buffer.alloc(8);
  h.writeBigUInt64BE(hisoblagich);
  const mac = createHmac(alg, siri).update(h).digest();
  const o = (mac[mac.length - 1] ?? 0) & 0x0f;
  const kod = ((mac.readUInt32BE(o) & 0x7fffffff) % 10 ** raqam).toString();
  return kod.padStart(raqam, "0");
}

export const QADAM_S = 30;
export const qadam = (ms = Date.now()): bigint => BigInt(Math.floor(ms / 1000 / QADAM_S));

/**
 * Kod tekshiruvi: joriy qadam ± `oyna` (soat farqi). `oxirgi` dan katta qadamgina qabul qilinadi — bir kodni (yoki eski kodni) qayta ishlatib bo'lmaydi.
 * @returns qabul qilingan qadam yoki undefined
 */
export function totpTekshir(siri: Buffer, kod: string, oxirgi: bigint, ms = Date.now(), oyna = 1): bigint | undefined {
  if (!/^\d{6}$/.test(kod)) return undefined;
  const t = qadam(ms);
  for (let i = -oyna; i <= oyna; i++) {
    const q = t + BigInt(i);
    if (q <= oxirgi) continue;
    if (timingSafeEqual(Buffer.from(hotp(siri, q)), Buffer.from(kod))) return q;
  }
  return undefined;
}

export function otpauthUri(siri: Buffer, hisob: string, nashriyot = "vazifalar"): string {
  const p = new URLSearchParams({ secret: base32(siri), issuer: nashriyot, algorithm: "SHA1", digits: "6", period: String(QADAM_S) });
  return `otpauth://totp/${encodeURIComponent(`${nashriyot}:${hisob}`)}?${p.toString()}`;
}

/** AES-256-GCM: iv(12) + teg(16) + shifrlangan; aad — foydalanuvchi id (bir hisobning shifrini boshqasiga ko'chirib bo'lmaydi) */
export function shifrla(kalit: Buffer, ochiq: Buffer, aad: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", kalit, iv).setAAD(Buffer.from(aad));
  const sh = Buffer.concat([c.update(ochiq), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), sh]);
}

export function deshifrla(kalit: Buffer, b: Buffer, aad: string): Buffer {
  const d = createDecipheriv("aes-256-gcm", kalit, b.subarray(0, 12)).setAAD(Buffer.from(aad));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}
