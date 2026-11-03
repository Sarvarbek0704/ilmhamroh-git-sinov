// zaxira.ts — 31-qism #16 (B-207): zaxira model. Asosiy model vaqtinchalik xato bersa (429 limit, 503/529 band, timeout, 5xx) — xuddi shu so'rov
// bir marta ZAXIRA model bilan (masalan kichikroq/boshqa avlod). Doimiy xatolar (400, sxema, rad) — zaxiraga o'tkazilmaydi: ular boshqa model bilan ham takrorlanadi.
// Dekorator: LlmProvayder'ni o'raydi — ilova kodi o'zgarmaydi. Oqimda — faqat birinchi bo'lakdan OLDINGI xatoda (mijozga yarim javob ikki marta ketmasin).
import { LlmXatosi } from "./llm.ts";
import type { EmbeddingTuri, LlmBolak, LlmJavob, LlmProvayder, LlmSorov } from "./llm.ts";

export class ZaxiraliProvayder implements LlmProvayder {
  readonly nom: string;
  readonly model: string;
  /** zaxiraga necha marta o'tildi (log/metrika uchun) */
  otishlar = 0;
  constructor(private readonly asosiy: LlmProvayder, private readonly zaxiraModel: string) {
    this.nom = asosiy.nom;
    this.model = asosiy.model;
  }

  /** 32 #01: asosiy modelning breaker'i OCHIQ bo'lsa ham zaxiraga o'tiladi (`ochiq` qayta urinish uchun vaqtinchalik emas, lekin zaxira uchun — aynan shu holat) */
  #otsinmi(x: unknown, s: LlmSorov): boolean {
    return x instanceof LlmXatosi && (x.vaqtinchalik || x.tur === "ochiq") && s.signal?.aborted !== true && (s.model ?? this.model) !== this.zaxiraModel;
  }

  async yarat(s: LlmSorov): Promise<LlmJavob> {
    try {
      return await this.asosiy.yarat(s);
    } catch (x) {
      if (!this.#otsinmi(x, s)) throw x;
      this.otishlar++;
      return this.asosiy.yarat({ ...s, model: this.zaxiraModel });
    }
  }

  async *oqim(s: LlmSorov): AsyncIterable<LlmBolak> {
    let berildi = false;
    try {
      for await (const b of this.asosiy.oqim(s)) { berildi = true; yield b; }
    } catch (x) {
      if (berildi || !this.#otsinmi(x, s)) throw x;
      this.otishlar++;
      yield* this.asosiy.oqim({ ...s, model: this.zaxiraModel });
    }
  }

  embedding(matnlar: string[], tur: EmbeddingTuri, signal?: AbortSignal): Promise<number[][]> {
    return this.asosiy.embedding(matnlar, tur, signal); // embedding modeli o'zgarsa — vektorlar mos kelmaydi; zaxira YO'Q
  }
}
