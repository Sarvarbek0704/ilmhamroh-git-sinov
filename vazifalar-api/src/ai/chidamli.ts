// chidamli.ts — 31-qism #29 (B-220): resilience naqshlari LLM provayderi atrofida (dekorator — ilova kodi o'zgarmaydi):
//   timeout (provayderda — har urinishga), retry (faqat vaqtinchalik xato; eksponensial + to'liq jitter; Retry-After hurmat qilinadi),
//   circuit breaker (ketma-ket N xato → OCHIQ: T ms davomida darhol `ochiq` xatosi; keyin YARIM-OCHIQ — bitta sinov so'rovi),
//   bulkhead (bir vaqtda ko'pi bilan K ta LLM chaqiruvi — qolganlari darhol `band`: sekin provayder butun ilovaning ulanish/xotirasini yemasin).
// 32-qism #01 (31 nuqsoni): breaker HAR MODELGA ALOHIDA (kalit — so'rovdagi `model`, berilmasa provayder sukuti). Avval bitta umumiy breaker edi:
//   kam yukda zaxira muvaffaqiyati o'lik asosiy model hisoblagichini nolga qaytarardi (breaker hech ochilmasdi — o'lik model har safar 3 marta),
//   parallel yukda asosiy xatolari umumiy breaker'ni ochib, SOG' zaxirani ham to'sardi. Bulkhead — umumiy (u modelni emas, ILOVA resursini himoya qiladi).
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

/** bitta model uchun circuit breaker holat mashinasi (yopiq → ochiq → yarim → yopiq/ochiq) */
class Breaker {
  #holat: BreakerHolati = "yopiq";
  #xatolar = 0;
  #ochilgan = 0;
  constructor(private readonly s: Required<ChidamlilikSozlamasi>) {}

  get holat(): BreakerHolati {
    if (this.#holat === "ochiq" && this.s.soat() - this.#ochilgan >= this.s.breakerOchiqMs) this.#holat = "yarim";
    return this.#holat;
  }

  /** ochiq bo'lsa — qancha ms qolgani (Retry-After uchun), aks holda undefined */
  qolganMs(): number | undefined {
    return this.holat === "ochiq" ? this.s.breakerOchiqMs - (this.s.soat() - this.#ochilgan) : undefined;
  }

  muvaffaqiyat(): void { this.#xatolar = 0; this.#holat = "yopiq"; }

  xato(x: unknown): void {
    if (!(x instanceof LlmXatosi) || !x.vaqtinchalik) return; // foydalanuvchi bekor qilgani, sxema xatosi — provayder sog'lig'iga aloqasi yo'q
    this.#xatolar++;
    if (this.#holat === "yarim" || this.#xatolar >= this.s.breakerChegara) { this.#holat = "ochiq"; this.#ochilgan = this.s.soat(); }
  }
}

export class ChidamliProvayder implements LlmProvayder {
  readonly nom: string;
  readonly model: string;
  readonly #s: Required<ChidamlilikSozlamasi>;
  readonly #breakerlar = new Map<string, Breaker>();
  #band = 0;
  /** metrikalar (#28): urinishlar, qayta urinishlar, breaker rad etganlar, bulkhead rad etganlar (hamma modellar bo'yicha) */
  readonly hisob = { chaqiruv: 0, qaytaUrinish: 0, breakerRad: 0, bulkheadRad: 0 };

  constructor(private readonly ichki: LlmProvayder, s: ChidamlilikSozlamasi) {
    this.nom = ichki.nom;
    this.model = ichki.model;
    this.#s = { asosMs: 300, breakerChegara: 5, breakerOchiqMs: 30_000, maksParallel: 8, kut: sukutKut, soat: Date.now, ...s };
  }

  #breaker(model: string | undefined): Breaker {
    const k = model ?? this.model;
    let b = this.#breakerlar.get(k);
    if (b === undefined) { b = new Breaker(this.#s); this.#breakerlar.set(k, b); }
    return b;
  }

  /** sukut modelining breaker holati (31-qism testlari shu bilan); boshqa model — `holatModel()` */
  get holat(): BreakerHolati {
    return this.#breaker(undefined).holat;
  }

  holatModel(model: string): BreakerHolati {
    return this.#breaker(model).holat;
  }

  #ruxsat(b: Breaker): void {
    const qolgan = b.qolganMs();
    if (qolgan !== undefined) { this.hisob.breakerRad++; throw new LlmXatosi("ochiq", "AI provayderi vaqtincha o'chirilgan (circuit breaker ochiq)", qolgan); }
    if (this.#band >= this.#s.maksParallel) { this.hisob.bulkheadRad++; throw new LlmXatosi("band", `bir vaqtda ${String(this.#s.maksParallel)} tadan ko'p AI so'rovi`, 1000); }
  }

  async #urin<T>(b: Breaker, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.#ruxsat(b);
    this.#band++;
    try {
      for (let n = 0; ; n++) {
        this.hisob.chaqiruv++;
        try {
          const r = await fn();
          b.muvaffaqiyat();
          return r;
        } catch (x) {
          b.xato(x);
          const qayta = x instanceof LlmXatosi && x.vaqtinchalik && n < this.#s.qaytaUrinish && b.holat !== "ochiq" && signal?.aborted !== true;
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
    return this.#urin(this.#breaker(s.model), () => this.ichki.yarat(s), s.signal);
  }

  /** oqim: qayta urinish yo'q (yarim javob mijozga ketgan bo'lishi mumkin); breaker va bulkhead — bor */
  async *oqim(s: LlmSorov): AsyncIterable<LlmBolak> {
    const b = this.#breaker(s.model);
    this.#ruxsat(b);
    this.#band++;
    try {
      for await (const x of this.ichki.oqim(s)) yield x;
      b.muvaffaqiyat();
    } catch (x) {
      b.xato(x);
      throw x;
    } finally {
      this.#band--;
    }
  }

  embedding(matnlar: string[], tur: EmbeddingTuri, signal?: AbortSignal): Promise<number[][]> {
    return this.#urin(this.#breaker("embedding"), () => this.ichki.embedding(matnlar, tur, signal), signal);
  }
}
