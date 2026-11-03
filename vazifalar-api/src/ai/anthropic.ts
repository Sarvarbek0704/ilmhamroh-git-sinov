// anthropic.ts — 31-qism #16: Anthropic Messages API provayderi. SINALMAGAN (kalit yo'q; kanon Gemini bilan sinaldi, 2026-11-02).
// Strukturali javob — "tool use" orqali: bitta majburiy vosita (`tool_choice`), uning input_schema'si — bizning JSON Schema; javob — vosita argumentlari.
// Embedding Anthropic'da yo'q — embedding() xato beradi (semantik qidiruv uchun boshqa provayder kerak — #17 darsida).
import { chegaraliSignal, httpXatosi, LlmXatosi, sseMalumot, xatogaAylantir } from "./llm.ts";
import type { LlmBolak, LlmJavob, LlmProvayder, LlmSorov } from "./llm.ts";

export type AnthropicSozlamasi = { kalit: string; model: string; timeoutMs: number; api?: string };

type Blok = { type: string; text?: string; input?: unknown };
type MessageJavob = { model?: string; content?: Blok[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };

export class AnthropicProvayder implements LlmProvayder {
  readonly nom = "anthropic";
  readonly model: string;
  readonly #s: Required<AnthropicSozlamasi>;
  constructor(s: AnthropicSozlamasi) {
    this.#s = { api: "https://api.anthropic.com/v1", ...s };
    this.model = s.model;
  }

  #tana(s: LlmSorov, oqim: boolean): Record<string, unknown> {
    return {
      model: s.model ?? this.model,
      system: s.tizim,
      max_tokens: s.maksToken ?? 1024,
      temperature: s.harorat ?? 0.2,
      messages: s.xabarlar.map((x) => ({ role: x.rol === "model" ? "assistant" : "user", content: x.matn })),
      ...(s.jsonSxema === undefined ? {} : { tools: [{ name: "javob", description: "Javobni shu sxemada qaytar", input_schema: s.jsonSxema }], tool_choice: { type: "tool", name: "javob" } }),
      ...(oqim ? { stream: true } : {}),
    };
  }

  async #post(tana: unknown, signal: AbortSignal): Promise<Response> {
    const r = await fetch(`${this.#s.api}/messages`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": this.#s.kalit, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(tana),
    });
    if (!r.ok) throw httpXatosi(r.status, `Anthropic ${String(r.status)}: ${(await r.text().catch(() => "")).slice(0, 200)}`, r.headers.get("retry-after"));
    return r;
  }

  async yarat(s: LlmSorov): Promise<LlmJavob> {
    const t0 = performance.now();
    try {
      const j = (await (await this.#post(this.#tana(s, false), chegaraliSignal(this.#s.timeoutMs, s.signal))).json()) as MessageJavob;
      const bloklar = j.content ?? [];
      const vosita = bloklar.find((b) => b.type === "tool_use");
      const matn = vosita !== undefined ? JSON.stringify(vosita.input) : bloklar.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      return { matn, model: j.model ?? this.model, tokenlar: { kirish: j.usage?.input_tokens ?? 0, chiqish: j.usage?.output_tokens ?? 0 }, tugash: j.stop_reason ?? "NOMALUM", ms: Math.round(performance.now() - t0) };
    } catch (x) {
      throw xatogaAylantir(x, s.signal);
    }
  }

  async *oqim(s: LlmSorov): AsyncIterable<LlmBolak> {
    const t0 = performance.now();
    let matn = "", tugash = "NOMALUM";
    const tokenlar = { kirish: 0, chiqish: 0 };
    try {
      const r = await this.#post(this.#tana(s, true), chegaraliSignal(this.#s.timeoutMs, s.signal));
      if (r.body === null) throw new LlmXatosi("provayder", "oqim tanasi yo'q");
      for await (const data of sseMalumot(r.body)) {
        const h = JSON.parse(data) as { type?: string; delta?: { text?: string; partial_json?: string; stop_reason?: string }; message?: MessageJavob; usage?: { output_tokens?: number } };
        if (h.type === "message_start") tokenlar.kirish = h.message?.usage?.input_tokens ?? 0;
        if (h.type === "message_delta") { tokenlar.chiqish = h.usage?.output_tokens ?? 0; tugash = h.delta?.stop_reason ?? tugash; }
        const b = h.type === "content_block_delta" ? (h.delta?.text ?? h.delta?.partial_json ?? "") : "";
        if (b !== "") { matn += b; yield { tur: "matn", matn: b }; }
      }
    } catch (x) {
      throw xatogaAylantir(x, s.signal);
    }
    yield { tur: "tugadi", javob: { matn, model: s.model ?? this.model, tokenlar, tugash, ms: Math.round(performance.now() - t0) } };
  }

  embedding(): Promise<number[][]> {
    return Promise.reject(new LlmXatosi("provayder", "Anthropic API'da embedding yo'q — AI_EMBEDDING uchun boshqa provayder kerak"));
  }
}
