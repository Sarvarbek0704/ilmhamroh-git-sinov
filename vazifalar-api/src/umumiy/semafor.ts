// semafor.ts — #29 B-132 (holat 29): qimmat ish (argon2 — ~30 ms CPU + 19 MiB) uchun bir vaqtda N ta va navbat chegarasi. Navbat to'lsa — darhol 503
// (kutib turgan so'rovlar pool ulanishlarini va xotirani band qilmasin). t29: 200 parallel login paytida oddiy GET p99 42 ms → 3.3 s edi.
import { IlovaXatosi } from "./xatolar.ts";

export class BandXatosi extends IlovaXatosi {
  constructor() {
    super(503, "Server band — bir oz kutib qayta urinib ko'ring", { kod: "server-band", sarlavha: "Server band", httpSarlavhalar: { "Retry-After": "1" } });
  }
}

export class Semafor {
  readonly #maks: number;
  readonly #navbatMaks: number;
  #band = 0;
  readonly #navbat: (() => void)[] = [];

  constructor(maks: number, navbatMaks: number) {
    this.#maks = maks;
    this.#navbatMaks = navbatMaks;
  }

  get holat(): { band: number; navbat: number } {
    return { band: this.#band, navbat: this.#navbat.length };
  }

  async bajar<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#band >= this.#maks) {
      if (this.#navbat.length >= this.#navbatMaks) throw new BandXatosi();
      await new Promise<void>((ok) => this.#navbat.push(ok));
    } else {
      this.#band++;
    }
    try {
      return await fn();
    } finally {
      const keyingi = this.#navbat.shift();
      if (keyingi === undefined) this.#band--;
      else keyingi(); // joy keyingisiga o'tadi (band soni o'zgarmaydi)
    }
  }
}
