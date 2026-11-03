// chidamli.ts — 31-qism #29 (B-220): resilience naqshlari LLM provayderi atrofida (dekorator — ilova kodi o'zgarmaydi):
//   timeout (provayderda — har urinishga), retry (faqat vaqtinchalik xato; eksponensial + to'liq jitter; Retry-After hurmat qilinadi),
//   circuit breaker (ketma-ket N xato → OCHIQ: T ms davomida darhol `ochiq` xatosi; keyin YARIM-OCHIQ — bitta sinov so'rovi),
//   bulkhead (bir vaqtda ko'pi bilan K ta LLM chaqiruvi — qolganlari darhol `band`: sekin provayder butun ilovaning ulanish/xotirasini yemasin).
// Opossum (circuit breaker paketi) — SINALMAGAN (o'z ~100 qatorli dekoratorimiz: LlmXatosi turlari va Retry-After bilan bevosita); kanonda 0 paket.
import { LlmXatosi } from "./llm.ts";
import type { EmbeddingTuri, LlmBolak, LlmJavob, LlmProvayder, LlmSorov } from "./llm.ts";

export type ChidamlilikSozlamasi = {
  qaytaUrinish: number;          // vaqtinchalik xatoda qo'shimcha urinishlar (0 — o'chiq)
  asosMs?: number;               // backoff asosi (sukut 300 ms): kutish = random(0, asos·2^n), maks 8 s
  breakerChegara?: number;       // ketma-ket xatolar (sukut 5)
  breakerOchiqMs?: number;       // ochiq turish vaqti (sukut 30 s)
  maksParallel?: number;         // bulkhead (sukut 8)
  kut?: (ms: number, signal?: AbortSignal) => Promise<void>;  // testlar uchun
  soat?: () => number;
};

export type BreakerHolati = "yopiq" | "ochiq" | "yarim";

const sukutKut = (ms: number, signal?: AbortSignal) => new Promise<void>((ok, rad) => {
  const t = setTimeout(ok, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); rad(signal.reason instanceof Error ? signal.reason : new DOMException("bekor", "AbortError")); }, { once: true });
});

export class ChidamliProvayder implements LlmProvayder {
  readonly nom: string;
  readonly model: string;
  readonly #s: Required<ChidamlilikSozlamasi>;
  #holat: BreakerHolati = "yopiq";
  #xatolar = 0;
  #ochilgan = 0;
  #band = 0;
  /** metrikalar (#28): urinishlar, qayta urinishlar, breaker rad etganlar, bulkhead rad etganlar */
  readonly hisob = { chaqiruv: 0, qaytaUrinish: 0, breakerRad: 0, bulkheadRad: 0 };

  constructor(private readonly ichki: LlmProvayder, s: ChidamlilikSozlamasi) {
    this.nom = ichki.nom;
    this.model = ichki.model;
    this.#s = { asosMs: 300, breakerChegara: 5, breakerOchiqMs: 30_000, maksParallel: 8, kut: sukutKut, soat: Date.now, ...s };
  }

  get holat(): BreakerHolati {
    if (this.#holat === "ochiq" && this.#s.soat() - this.#ochilgan >= this.#s.breakerOchiqMs) this.#holat = "yarim";
    return this.#holat;
  }

  #ruxsat(): void {
    const h = this.holat;
    if (h === "ochiq") { this.hisob.breakerRad++; throw new LlmXatosi("ochiq", "AI provayderi vaqtincha o'chirilgan (circuit breaker ochiq)", this.#s.breakerOchiqMs - (this.#s.soat() - this.#ochilgan)); }
    if (this.#band >= this.#s.maksParallel) { this.hisob.bulkheadRad++; throw new LlmXatosi("band", `bir vaqtda ${String(this.#s.maksParallel)} tadan ko'p AI so'rovi`, 1000); }
  }

  #muvaffaqiyat(): void { this.#xatolar = 0; this.#holat = "yopiq"; }

  #xato(x: unknown): void {
    if (!(x instanceof LlmXatosi) || !x.vaqtinchalik) return; // foydalanuvchi bekor qilgani, sxema xatosi — provayder sog'lig'iga aloqasi yo'q
    this.#xatolar++;
    if (this.#holat === "yarim" || this.#xatolar >= this.#s.breakerChegara) { this.#holat = "ochiq"; this.#ochilgan = this.#s.soat(); }
  }

  async #urin<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.#ruxsat();
    this.#band++;
    try {
      for (let n = 0; ; n++) {
        this.hisob.chaqiruv++;
        try {
          const r = await fn();
          this.#muvaffaqiyat();
          return r;
        } catch (x) {
          this.#xato(x);
          const qayta = x instanceof LlmXatosi && x.vaqtinchalik && n < this.#s.qaytaUrinish && this.holat !== "ochiq" && signal?.aborted !== true;
          if (!qayta) throw x;
          this.hisob.qaytaUrinish++;
          const jitter = Math.random() * Math.min(8000, this.#s.asosMs * 2 ** n);
          await this.#s.kut(Math.max(jitter, x.qaytaUrinishMs ?? 0), signal);
        }
      }
    } finally {
      this.#band--;
    }
  }

  yarat(s: LlmSorov): Promise<LlmJavob> {
    return this.#urin(() => this.ichki.yarat(s), s.signal);
  }

  /** oqim: qayta urinish yo'q (yarim javob mijozga ketgan bo'lishi mumkin); breaker va bulkhead — bor */
  async *oqim(s: LlmSorov): AsyncIterable<LlmBolak> {
    this.#ruxsat();
    this.#band++;
    try {
      for await (const b of this.ichki.oqim(s)) yield b;
      this.#muvaffaqiyat();
    } catch (x) {
      this.#xato(x);
      throw x;
    } finally {
      this.#band--;
    }
  }

  embedding(matnlar: string[], tur: EmbeddingTuri, signal?: AbortSignal): Promise<number[][]> {
    return this.#urin(() => this.ichki.embedding(matnlar, tur, signal), signal);
  }
}
