// gemini.ts — 31-qism #13–#17: Google Gemini API (REST, SDK'siz — fetch; @google/genai bilan solishtirish — t16). Kalit — faqat `x-goog-api-key`
// sarlavhasida (URL'da `?key=` EMAS — URL loglarga tushadi). Sinalgan: 2026-11-02, gemini-3.5-flash-lite, gemini-embedding-2.
import { chegaraliSignal, httpXatosi, LlmXatosi, sseMalumot, xatogaAylantir } from "./llm.ts";
import type { EmbeddingTuri, LlmBolak, LlmJavob, LlmProvayder, LlmSorov } from "./llm.ts";

const API = "https://generativelanguage.googleapis.com/v1beta";

type Qism = { text?: string; thought?: boolean };
type GeminiJavob = {
  candidates?: { content?: { parts?: Qism[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
  error?: { message?: string; status?: string };
};

export type GeminiSozlamasi = { kalit: string; model: string; embeddingModel: string; timeoutMs: number; embeddingOlcham?: number; api?: string };

export class GeminiProvayder implements LlmProvayder {
  readonly nom = "gemini";
  readonly model: string;
  readonly #s: Required<GeminiSozlamasi>;

  constructor(s: GeminiSozlamasi) {
    this.#s = { embeddingOlcham: 768, api: API, ...s };
    this.model = s.model;
  }

  #tana(s: LlmSorov): Record<string, unknown> {
    return {
      systemInstruction: { parts: [{ text: s.tizim }] },
      contents: s.xabarlar.map((x) => ({ role: x.rol, parts: [{ text: x.matn }] })),
      generationConfig: {
        temperature: s.harorat ?? 0.2,
        maxOutputTokens: s.maksToken ?? 1024,
        ...(s.jsonSxema === undefined ? {} : { responseMimeType: "application/json", responseJsonSchema: s.jsonSxema }),
      },
    };
  }

  async #post(yol: string, tana: unknown, signal: AbortSignal): Promise<Response> {
    const r = await fetch(`${this.#s.api}/${yol}`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-goog-api-key": this.#s.kalit },
      body: JSON.stringify(tana),
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as GeminiJavob;
      throw httpXatosi(r.status, `Gemini ${String(r.status)}: ${j.error?.status ?? ""} ${(j.error?.message ?? "").slice(0, 200)}`, r.headers.get("retry-after"));
    }
    return r;
  }

  #javob(j: GeminiJavob, model: string, ms: number): LlmJavob {
    if (j.promptFeedback?.blockReason !== undefined) throw new LlmXatosi("rad", `so'rov rad etildi: ${j.promptFeedback.blockReason}`);
    const n = j.candidates?.[0];
    const matn = (n?.content?.parts ?? []).filter((p) => p.thought !== true).map((p) => p.text ?? "").join("");
    const tugash = n?.finishReason ?? "NOMALUM";
    if (matn === "" && tugash !== "STOP") throw new LlmXatosi("rad", `bo'sh javob (${tugash})`);
    const u = j.usageMetadata ?? {};
    // fikrlash (thinking) tokenlari ham chiqish narxida hisoblanadi (t13)
    return { matn, model: j.modelVersion ?? model, tokenlar: { kirish: u.promptTokenCount ?? 0, chiqish: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) }, tugash, ms };
  }

  async yarat(s: LlmSorov): Promise<LlmJavob> {
    const model = s.model ?? this.model;
    const signal = chegaraliSignal(this.#s.timeoutMs, s.signal);
    const t0 = performance.now();
    try {
      const r = await this.#post(`models/${model}:generateContent`, this.#tana(s), signal);
      return this.#javob((await r.json()) as GeminiJavob, model, Math.round(performance.now() - t0));
    } catch (x) {
      throw xatogaAylantir(x, s.signal);
    }
  }

  async *oqim(s: LlmSorov): AsyncIterable<LlmBolak> {
    const model = s.model ?? this.model;
    const signal = chegaraliSignal(this.#s.timeoutMs, s.signal);
    const t0 = performance.now();
    let matn = "";
    let oxirgi: GeminiJavob = {};
    try {
      const r = await this.#post(`models/${model}:streamGenerateContent?alt=sse`, this.#tana(s), signal);
      if (r.body === null) throw new LlmXatosi("provayder", "oqim tanasi yo'q");
      for await (const data of sseMalumot(r.body)) {
        const j = JSON.parse(data) as GeminiJavob;
        oxirgi = { ...oxirgi, ...j };
        const bolak = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => p.thought !== true).map((p) => p.text ?? "").join("");
        if (bolak !== "") {
          matn += bolak;
          yield { tur: "matn", matn: bolak };
        }
      }
    } catch (x) {
      throw xatogaAylantir(x, s.signal);
    }
    const javob = this.#javob(oxirgi, model, Math.round(performance.now() - t0));
    yield { tur: "tugadi", javob: { ...javob, matn } };
  }

  async embedding(matnlar: string[], tur: EmbeddingTuri, signal?: AbortSignal): Promise<number[][]> {
    if (matnlar.length === 0) return [];
    const model = `models/${this.#s.embeddingModel}`;
    const prefiks = prefiksliModel(this.#s.embeddingModel);
    const taskType = tur === "hujjat" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY";
    const s = chegaraliSignal(this.#s.timeoutMs, signal);
    try {
      const r = await this.#post(`${model}:batchEmbedContents`, {
        requests: matnlar.map((text) => prefiks
          ? { model, content: { parts: [{ text: embeddingMatni(text, tur) }] }, outputDimensionality: this.#s.embeddingOlcham }
          : { model, content: { parts: [{ text }] }, taskType, outputDimensionality: this.#s.embeddingOlcham }),
      }, s);
      const j = (await r.json()) as { embeddings?: { values?: number[] }[] };
      const v = (j.embeddings ?? []).map((e) => e.values ?? []);
      if (v.length !== matnlar.length || v.some((x) => x.length !== this.#s.embeddingOlcham)) throw new LlmXatosi("provayder", "embedding javobi shakli kutilganidek emas");
      return v.map(normallashtir);
    } catch (x) {
      throw xatogaAylantir(x, signal);
    }
  }
}

/**
 * 32 #01 (31 nuqsoni): `gemini-embedding-2` `taskType` maydonini QO'LLAMAYDI — vazifa matnning o'zida, prefiks bilan beriladi
 * (Gemini API hujjati, "Embeddings", 2026-11-03 holatiga; 31-qism kuchaytiruvchisi va bosh muharrir tekshirgan). 31 kanoni `taskType` yuborgan — u e'tiborsiz
 * qolgan, so'rov va hujjat vektorlari bir xil "turda" hisoblangan. Eski modellar (`gemini-embedding-001`) — `taskType` bilan qoladi.
 * Sifat ta'siri QAYTA O'LCHANMAGAN (32-qismda AI API'ga so'rov yo'q) — faqat so'rov shakli soxta fetch bilan tekshirilgan.
 */
export function prefiksliModel(model: string): boolean {
  return model.startsWith("gemini-embedding-2");
}

export function embeddingMatni(matn: string, tur: EmbeddingTuri): string {
  return tur === "sorov" ? `task: search result | query: ${matn}` : `title: none | text: ${matn}`;
}

/** bazadagi `vazifa_embeddinglar.model` yorlig'i: matn shakli o'zgargani uchun eski (prefikssiz) vektorlar dangasa QAYTA hisoblanadi (Qidiruv model farqini ko'radi) */
export function embeddingYorligi(model: string): string {
  return prefiksliModel(model) ? `${model}+prefiks` : model;
}

/** outputDimensionality < to'liq o'lcham bo'lsa Gemini vektori normallashmagan qaytadi (hujjat) — cosine uchun birlik uzunlikka keltiramiz */
export function normallashtir(v: number[]): number[] {
  const u = Math.hypot(...v);
  return u === 0 ? v : v.map((x) => x / u);
}
