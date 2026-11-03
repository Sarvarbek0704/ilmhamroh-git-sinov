// llm.ts — 31-qism #13 (B-204): LLM provayderi shartnomasi. Ilova kodi faqat shu interfeysni biladi — Gemini, OpenAI-mos, Anthropic yoki
// testdagi soxta provayder almashadi (#16). Matn va tokenlar — provayderdan mustaqil shaklda.

export type Rol = "user" | "model";
export type LlmXabar = { rol: Rol; matn: string };

export type LlmSorov = {
  /** tizim ko'rsatmasi (system prompt) — foydalanuvchi matnidan ALOHIDA maydon (#19 prompt injection) */
  tizim: string;
  xabarlar: LlmXabar[];
  /** strukturali javob (#15): JSON Schema — provayder shu shaklda JSON qaytaradi (keyin baribir Zod bilan tekshiriladi) */
  jsonSxema?: Record<string, unknown> | undefined;
  harorat?: number | undefined;
  maksToken?: number | undefined;
  /** foydalanuvchi uzilsa / timeout — so'rov bekor qilinadi (#14) */
  signal?: AbortSignal | undefined;
  /** model almashtirish (#16 zaxira model); berilmasa — provayder sukuti */
  model?: string | undefined;
};

export type Tokenlar = { kirish: number; chiqish: number };
export type LlmJavob = { matn: string; model: string; tokenlar: Tokenlar; tugash: string; ms: number };
/** oqim (#14): matn bo'laklari, oxirida — yakuniy javob (token hisobi bilan) */
export type LlmBolak = { tur: "matn"; matn: string } | { tur: "tugadi"; javob: LlmJavob };

export type EmbeddingTuri = "hujjat" | "sorov";

export interface LlmProvayder {
  readonly nom: string;
  readonly model: string;
  yarat(s: LlmSorov): Promise<LlmJavob>;
  oqim(s: LlmSorov): AsyncIterable<LlmBolak>;
  /** #17: matnlar → vektorlar (bir xil o'lcham); tur — hujjat yoki qidiruv so'rovi (ba'zi modellar farqlaydi) */
  embedding(matnlar: string[], tur: EmbeddingTuri, signal?: AbortSignal): Promise<number[][]>;
}

/**
 * LLM xatolari — HTTP holatiga aylantirish uchun turlangan (#19, #29):
 *   limit (429; retry-after) · band (503/529 — provayder yuklangan) · timeout · rad (xavfsizlik filtri, bo'sh javob) · notogri (sxemaga mos emas) · provayder (boshqa 4xx/5xx) · ochiq (circuit breaker)
 */
export type LlmXatoTuri = "limit" | "band" | "timeout" | "rad" | "notogri" | "provayder" | "ochiq";
export class LlmXatosi extends Error {
  constructor(readonly tur: LlmXatoTuri, xabar: string, readonly qaytaUrinishMs?: number, readonly status?: number) {
    super(xabar);
    this.name = "LlmXatosi";
  }
  /** qayta urinsa bo'ladimi (#29): faqat vaqtinchalik xatolar */
  get vaqtinchalik(): boolean {
    return this.tur === "limit" || this.tur === "band" || this.tur === "timeout" || (this.tur === "provayder" && (this.status ?? 0) >= 500);
  }
}

/** so'rov signali + o'z timeout'i (AbortSignal.any) — timeout bo'lsa LlmXatosi("timeout"), foydalanuvchi uzsa — AbortError o'zicha */
export function chegaraliSignal(ms: number, tashqi?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return tashqi === undefined ? t : AbortSignal.any([t, tashqi]);
}

export function xatogaAylantir(x: unknown, tashqi?: AbortSignal): unknown {
  if (x instanceof LlmXatosi) return x;
  if (x instanceof Error && (x.name === "TimeoutError" || (x.name === "AbortError" && tashqi?.aborted !== true))) return new LlmXatosi("timeout", "LLM javobi vaqtida kelmadi");
  return x;
}

/** HTTP holati → LlmXatosi (provayderlar umumiy) */
export function httpXatosi(status: number, xabar: string, retryAfter: string | null): LlmXatosi {
  const kut = retryAfter === null ? undefined : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) || undefined;
  if (status === 429) return new LlmXatosi("limit", xabar, kut, status);
  if (status === 503 || status === 529) return new LlmXatosi("band", xabar, kut, status);
  return new LlmXatosi("provayder", xabar, undefined, status);
}

/** SSE oqimini satrlarga bo'lib `data:` qiymatlarini beradi (Gemini `alt=sse`, OpenAI `stream: true`, Anthropic) */
export async function* sseMalumot(tana: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const dekoder = new TextDecoder();
  const oquvchi = tana.getReader();
  let bufer = "";
  for (;;) {
    const { done, value } = await oquvchi.read();
    if (done) break;
    bufer += dekoder.decode(value, { stream: true });
    let i: number;
    while ((i = bufer.indexOf("\n")) >= 0) {
      const qator = bufer.slice(0, i).replace(/\r$/, "");
      bufer = bufer.slice(i + 1);
      if (qator.startsWith("data:")) yield qator.slice(5).trimStart();
    }
  }
}
