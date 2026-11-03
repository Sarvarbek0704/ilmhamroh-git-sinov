// openai.ts — 31-qism #16: OpenAI-mos Chat Completions provayderi (OpenAI, Groq, OpenRouter, lokal Ollama — `AI_BASE_URL`).
// SINALMAGAN: kanon faqat Gemini kaliti bilan sinaldi (2026-11-02). Shartnoma (LlmProvayder) va xato turlari Gemini bilan bir xil — testlar
// soxta provayder bilan; bu fayl tip va lint'dan o'tadi, haqiqiy API bilan yurgizilmagan.
import { chegaraliSignal, httpXatosi, LlmXatosi, sseMalumot, xatogaAylantir } from "./llm.ts";
import type { EmbeddingTuri, LlmBolak, LlmJavob, LlmProvayder, LlmSorov } from "./llm.ts";
import { normallashtir } from "./gemini.ts";

export type OpenAiSozlamasi = { kalit: string; model: string; embeddingModel: string; timeoutMs: number; api?: string; embeddingOlcham?: number };

type ChatJavob = {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null }; delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export class OpenAiMosProvayder implements LlmProvayder {
  readonly nom = "openai";
  readonly model: string;
  readonly #s: Required<OpenAiSozlamasi>;
  constructor(s: OpenAiSozlamasi) {
    this.#s = { api: "https://api.openai.com/v1", embeddingOlcham: 768, ...s };
    this.model = s.model;
  }

  #tana(s: LlmSorov, oqim: boolean): Record<string, unknown> {
    return {
      model: s.model ?? this.model,
      messages: [{ role: "system", content: s.tizim }, ...s.xabarlar.map((x) => ({ role: x.rol === "model" ? "assistant" : "user", content: x.matn }))],
      temperature: s.harorat ?? 0.2,
      max_completion_tokens: s.maksToken ?? 1024,
      ...(s.jsonSxema === undefined ? {} : { response_format: { type: "json_schema", json_schema: { name: "javob", strict: true, schema: s.jsonSxema } } }),
      ...(oqim ? { stream: true, stream_options: { include_usage: true } } : {}),
    };
  }

  async #post(yol: string, tana: unknown, signal: AbortSignal): Promise<Response> {
    const r = await fetch(`${this.#s.api}/${yol}`, { method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${this.#s.kalit}` }, body: JSON.stringify(tana) });
    if (!r.ok) throw httpXatosi(r.status, `OpenAI-mos ${String(r.status)}: ${(await r.text().catch(() => "")).slice(0, 200)}`, r.headers.get("retry-after"));
    return r;
  }

  async yarat(s: LlmSorov): Promise<LlmJavob> {
    const t0 = performance.now();
    try {
      const j = (await (await this.#post("chat/completions", this.#tana(s, false), chegaraliSignal(this.#s.timeoutMs, s.signal))).json()) as ChatJavob;
      const c = j.choices?.[0];
      if (typeof c?.message?.refusal === "string") throw new LlmXatosi("rad", `model rad etdi: ${c.message.refusal.slice(0, 100)}`);
      return { matn: c?.message?.content ?? "", model: j.model ?? this.model, tokenlar: { kirish: j.usage?.prompt_tokens ?? 0, chiqish: j.usage?.completion_tokens ?? 0 }, tugash: c?.finish_reason ?? "NOMALUM", ms: Math.round(performance.now() - t0) };
    } catch (x) {
      throw xatogaAylantir(x, s.signal);
    }
  }

  async *oqim(s: LlmSorov): AsyncIterable<LlmBolak> {
    const t0 = performance.now();
    let matn = "", tugash = "NOMALUM", model = this.model;
    const tokenlar = { kirish: 0, chiqish: 0 };
    try {
      const r = await this.#post("chat/completions", this.#tana(s, true), chegaraliSignal(this.#s.timeoutMs, s.signal));
      if (r.body === null) throw new LlmXatosi("provayder", "oqim tanasi yo'q");
      for await (const data of sseMalumot(r.body)) {
        if (data === "[DONE]") break;
        const j = JSON.parse(data) as ChatJavob;
        model = j.model ?? model;
        if (j.usage !== undefined) { tokenlar.kirish = j.usage.prompt_tokens ?? 0; tokenlar.chiqish = j.usage.completion_tokens ?? 0; }
        const c = j.choices?.[0];
        if (typeof c?.finish_reason === "string") tugash = c.finish_reason;
        const b = c?.delta?.content ?? "";
        if (b !== "") { matn += b; yield { tur: "matn", matn: b }; }
      }
    } catch (x) {
      throw xatogaAylantir(x, s.signal);
    }
    yield { tur: "tugadi", javob: { matn, model, tokenlar, tugash, ms: Math.round(performance.now() - t0) } };
  }

  async embedding(matnlar: string[], _tur: EmbeddingTuri, signal?: AbortSignal): Promise<number[][]> {
    if (matnlar.length === 0) return [];
    try {
      const r = await this.#post("embeddings", { model: this.#s.embeddingModel, input: matnlar, dimensions: this.#s.embeddingOlcham }, chegaraliSignal(this.#s.timeoutMs, signal));
      const j = (await r.json()) as { data?: { embedding?: number[] }[] };
      return (j.data ?? []).map((d) => normallashtir(d.embedding ?? []));
    } catch (x) {
      throw xatogaAylantir(x, signal);
    }
  }
}
