// imzo.ts — Standard Webhooks (standardwebhooks.com) imzosi: kiruvchi va chiquvchi webhook'lar uchun bitta format (B-168, B-169).
//   Sarlavhalar: webhook-id, webhook-timestamp (unix soniya), webhook-signature: "v1,<base64(HMAC-SHA256(kalit, `${id}.${timestamp}.${tana}`))>" (bo'shliq bilan bir nechta).
//   Sir: "whsec_" + base64(kalit baytlari). Tekshiruv: imzo (timingSafeEqual), vaqt oynasi (sukut ±5 daqiqa — replay himoyasi), XOM tana.
// Paketsiz yozilgan; `standardwebhooks` 1.1.1 bilan moslik testda tekshiriladi.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sirYarat = (): string => `whsec_${randomBytes(24).toString("base64")}`;
const kalit = (sir: string) => Buffer.from(sir.startsWith("whsec_") ? sir.slice(6) : sir, "base64");

export function imzola(sir: string, id: string, vaqtSoniya: number, tana: string): string {
  return `v1,${createHmac("sha256", kalit(sir)).update(`${id}.${String(vaqtSoniya)}.${tana}`).digest("base64")}`;
}

export function sarlavhalar(sir: string, id: string, tana: string, vaqtSoniya = Math.floor(Date.now() / 1000)): Record<string, string> {
  return { "webhook-id": id, "webhook-timestamp": String(vaqtSoniya), "webhook-signature": imzola(sir, id, vaqtSoniya, tana) };
}

export type TekshiruvNatija = { ok: true; id: string; vaqt: number } | { ok: false; sabab: "sarlavha" | "eski" | "kelajak" | "imzo" };

export function tekshir(sir: string, sarlavha: (nom: string) => string | undefined, xomTana: string | Buffer, o: { toleransSoniya?: number; hozirSoniya?: number } = {}): TekshiruvNatija {
  const id = sarlavha("webhook-id");
  const ts = sarlavha("webhook-timestamp");
  const imzolar = sarlavha("webhook-signature");
  if (!id || !ts || !imzolar || !/^\d{1,12}$/.test(ts)) return { ok: false, sabab: "sarlavha" };
  const vaqt = Number(ts);
  const hozir = o.hozirSoniya ?? Math.floor(Date.now() / 1000);
  const tol = o.toleransSoniya ?? 300;
  if (vaqt < hozir - tol) return { ok: false, sabab: "eski" };
  if (vaqt > hozir + tol) return { ok: false, sabab: "kelajak" };
  const kutilgan = Buffer.from(imzola(sir, id, vaqt, typeof xomTana === "string" ? xomTana : xomTana.toString("utf8")).slice(3), "base64");
  for (const bolak of imzolar.split(" ")) {
    const [ver, qiymat] = bolak.split(",");
    if (ver !== "v1" || !qiymat) continue;
    const b = Buffer.from(qiymat, "base64");
    if (b.length === kutilgan.length && timingSafeEqual(b, kutilgan)) return { ok: true, id, vaqt };
  }
  return { ok: false, sabab: "imzo" };
}
