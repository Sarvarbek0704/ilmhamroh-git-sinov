// fon.ts — #12 (holat 12): javobni kutdirmaydigan fon ishlari (xat yuborish). Sabab — o'lchov: parol tiklash so'rovi mavjud email uchun 30 ms,
// noma'lum uchun 12.8 ms edi (natijalar/tajriba/t12-tiklash-timing.txt) — javob matni bir xil bo'lsa ham VAQT email borligini oshkor qilardi.
// Endi ikkala yo'lda javob darhol; token + xat — fonda. Haqiqiy navbat (qayta urinish, jarayon qayta ishga tushsa ham yo'qolmaslik) — 29-qism (BullMQ).
type XatoLogi = { error: (obj: { err: unknown; ish: string }, xabar: string) => void };

export class FonIshlar {
  readonly #ishlar = new Set<Promise<void>>();
  readonly #log: () => XatoLogi;

  constructor(log: () => XatoLogi) {
    this.#log = log;
  }

  /** Ishni boshlaydi va KUTMAYDI. Xato yutilmaydi — log'ga */
  qosh(nom: string, ish: () => Promise<void>): void {
    const p: Promise<void> = ish()
      .catch((x: unknown) => { this.#log().error({ err: x, ish: nom }, "fon ishi bajarilmadi"); })
      .finally(() => { this.#ishlar.delete(p); });
    this.#ishlar.add(p);
  }

  /** Hamma boshlangan ishlar tugashini kutadi (server to'xtashida va testlarda) */
  async tugashi(): Promise<void> {
    while (this.#ishlar.size > 0) await Promise.all([...this.#ishlar]);
  }
}
