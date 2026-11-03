// captcha.ts — #30 B-133 (holat 30): CAPTCHA tokenini SERVERDA tekshirish — Cloudflare Turnstile siteverify (developers.cloudflare.com/turnstile).
// Brauzer vidjeti token beradi; token o'zi hech narsani isbotlamaydi — server uni sir kalit bilan Cloudflare'ga yuborib tekshiradi (bir marta, 300 s).
// Kanon sinovi: fetch — tikuv (mock); haqiqiy siteverify faqat RASMIY TEST kalitlari bilan (tajriba t30), haqiqiy Cloudflare hisobi ishlatilmagan.
export const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface CaptchaTekshiruvchi {
  /** true — inson (yoki test kaliti); tarmoq xatosi va javobsizlik — false (yopiq holatda xavfsiz) */
  tekshir(token: string | undefined, ip: string | undefined): Promise<{ ok: boolean; sabab?: string }>;
}

type Javob = { success?: unknown; "error-codes"?: unknown; hostname?: unknown; action?: unknown };

export class Turnstile implements CaptchaTekshiruvchi {
  readonly #sir: string;
  readonly #fetch: typeof fetch;
  readonly #hostname: string | undefined;

  /** @param hostname berilsa — token boshqa saytda olingan bo'lsa rad (token "ko'chirib" kelinmasin) */
  constructor(sir: string, { fetchFn = globalThis.fetch, hostname }: { fetchFn?: typeof fetch; hostname?: string } = {}) {
    this.#sir = sir;
    this.#fetch = fetchFn;
    this.#hostname = hostname;
  }

  async tekshir(token: string | undefined, ip: string | undefined): Promise<{ ok: boolean; sabab?: string }> {
    if (token === undefined || token === "" || token.length > 2048) return { ok: false, sabab: "token-yoq" };
    const tana = new URLSearchParams({ secret: this.#sir, response: token, ...(ip === undefined ? {} : { remoteip: ip }) });
    let j: Javob;
    try {
      const r = await this.#fetch(SITEVERIFY, { method: "POST", body: tana, signal: AbortSignal.timeout(3000) });
      j = (await r.json()) as Javob;
    } catch {
      return { ok: false, sabab: "siteverify-xato" };
    }
    if (j.success !== true) return { ok: false, sabab: Array.isArray(j["error-codes"]) ? j["error-codes"].join(",") : "rad" };
    if (this.#hostname !== undefined && j.hostname !== this.#hostname) return { ok: false, sabab: "hostname" };
    return { ok: true };
  }
}
