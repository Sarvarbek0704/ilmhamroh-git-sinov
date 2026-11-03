// soxta.ts — 31-qism: testlar uchun soxta LLM provayderi (tarmoqqa chiqmaydi, deterministik). `npm run check` tashqi API'ga BORMAYDI.
//   javob — funksiya: so'rovga qarab matn qaytaradi; kechikish, xato va oqim bo'laklari sozlanadi; chaqiruvlar yoziladi (test tekshiradi).
//   embedding — "so'zlar sumkasi" xeshi (o'xshash so'zli matnlar yaqin chiqadi) — pgvector testlari uchun yetarli, ma'no emas.
import { createHash } from "node:crypto";
import { LlmXatosi } from "./llm.ts";
import type { EmbeddingTuri, LlmBolak, LlmJavob, LlmProvayder, LlmSorov } from "./llm.ts";
import { normallashtir } from "./gemini.ts";

export type SoxtaSozlama = {
  javob?: (s: LlmSorov) => string;
  kechikishMs?: number;
  /** navbatdagi chaqiruvlarda tashlanadigan xatolar (har chaqiruv bittasini oladi) */
  xatolar?: LlmXatosi[];
  bolakUzunligi?: number;
  olcham?: number;
};

const kut = (ms: number, signal?: AbortSignal) => new Promise<void>((ok, rad) => {
  if (ms <= 0) { ok(); return; }
  const t = setTimeout(ok, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); rad(signal.reason instanceof Error ? signal.reason : new DOMException("bekor", "AbortError")); }, { once: true });
});

export class SoxtaProvayder implements LlmProvayder {
  readonly nom = "soxta";
  readonly model = "soxta-1";
  readonly chaqiruvlar: LlmSorov[] = [];
  embeddingChaqiruvlar = 0;
  constructor(readonly s: SoxtaSozlama = {}) {}

  async yarat(s: LlmSorov): Promise<LlmJavob> {
    this.chaqiruvlar.push(s);
    await kut(this.s.kechikishMs ?? 0, s.signal);
    const x = this.s.xatolar?.shift();
    if (x !== undefined) throw x;
    const matn = (this.s.javob ?? (() => "{}"))(s);
    return { matn, model: s.model ?? this.model, tokenlar: { kirish: Math.ceil(JSON.stringify(s.xabarlar).length / 4), chiqish: Math.ceil(matn.length / 4) }, tugash: "STOP", ms: this.s.kechikishMs ?? 0 };
  }

  async *oqim(s: LlmSorov): AsyncIterable<LlmBolak> {
    const j = await this.yarat(s);
    const n = this.s.bolakUzunligi ?? 7;
    for (let i = 0; i < j.matn.length; i += n) {
      await kut(this.s.kechikishMs === undefined ? 0 : 5, s.signal);
      yield { tur: "matn", matn: j.matn.slice(i, i + n) };
    }
    yield { tur: "tugadi", javob: j };
  }

  async embedding(matnlar: string[], _tur: EmbeddingTuri, signal?: AbortSignal): Promise<number[][]> {
    this.embeddingChaqiruvlar++;
    await kut(this.s.kechikishMs ?? 0, signal);
    const x = this.s.xatolar?.shift();
    if (x !== undefined) throw x;
    const n = this.s.olcham ?? 768;
    return matnlar.map((m) => {
      const v = new Array<number>(n).fill(0);
      for (const soz of m.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []) {
        const h = createHash("sha256").update(soz.slice(0, 5)).digest(); // o'zak ~ birinchi 5 harf (qo'shimchalar farqi kamayadi)
        v[h.readUInt32BE(0) % n] = (v[h.readUInt32BE(0) % n] ?? 0) + 1;
      }
      return normallashtir(v);
    });
  }
}

export { LlmXatosi };
