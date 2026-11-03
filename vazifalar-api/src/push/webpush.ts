// webpush.ts — Web Push (RFC 8030/8291/8292): VAPID bilan imzolangan, aes128gcm shifrlangan xabar. Natija turlari: yetkazildi / eskirgan obuna
// (404, 410 → bazadan o'chirish) / qayta urinish (429, 5xx) (B-151). FCM (Firebase Admin) — hujjat bo'yicha, SINALMAGAN (loyiha va kalit kerak).
import type { Agent } from "node:https";
import webpush from "web-push";

export type Obuna = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushNatija = { tur: "yetkazildi"; status: number } | { tur: "eskirgan"; status: number } | { tur: "qayta"; status: number; kutishSoniya?: number } | { tur: "xato"; status: number; sabab: string };

export const MAKS_YUK = 4096 - 103; // aes128gcm: 4096 bayt yozuv − 86 bayt sarlavha (salt 16 + rs 4 + idlen 1 + kalit 65) − 16 tag − 1 ajratgich

export class WebPush {
  readonly #vapid: { subject: string; publicKey: string; privateKey: string };
  readonly #agent: Agent | undefined;
  /** web-push faqat HTTPS endpoint'ga yuboradi (`https.request`); `agent` — test/mock uchun o'z CA si bilan. */
  constructor(vapid: { subject: string; publicKey: string; privateKey: string }, agent?: Agent) {
    this.#vapid = vapid;
    this.#agent = agent;
  }

  static kalitlarYarat(): { publicKey: string; privateKey: string } {
    return webpush.generateVAPIDKeys();
  }

  async yubor(obuna: Obuna, xabar: { sarlavha: string; matn: string; url?: string; teg?: string }, o: { ttl?: number; shoshilinch?: "very-low" | "low" | "normal" | "high" } = {}): Promise<PushNatija> {
    const yuk = JSON.stringify(xabar);
    if (Buffer.byteLength(yuk) > MAKS_YUK) return { tur: "xato", status: 0, sabab: `yuk ${String(Buffer.byteLength(yuk))} bayt > ${String(MAKS_YUK)}` };
    try {
      const r = await webpush.sendNotification(obuna, yuk, {
        vapidDetails: this.#vapid,
        TTL: o.ttl ?? 3600,
        urgency: o.shoshilinch ?? "normal",
        ...(xabar.teg ? { topic: xabar.teg.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}), // Topic: bir xil teg — eskisini almashtiradi (RFC 8030 §5.4)
        timeout: 10_000,
        ...(this.#agent ? { agent: this.#agent } : {}),
      });
      return { tur: "yetkazildi", status: r.statusCode };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode ?? 0;
      const tarmoq = typeof (e as { code?: unknown }).code === "string"; // ECONNRESET, ETIMEDOUT … — vaqtinchalik
      if (status === 404 || status === 410) return { tur: "eskirgan", status };
      if (status === 429 || status >= 500 || (status === 0 && tarmoq)) {
        const ra = Number((e as { headers?: Record<string, string> }).headers?.["retry-after"]);
        return Number.isFinite(ra) && ra > 0 ? { tur: "qayta", status, kutishSoniya: ra } : { tur: "qayta", status };
      }
      return { tur: "xato", status, sabab: e instanceof Error ? e.message : String(e) };
    }
  }
}
