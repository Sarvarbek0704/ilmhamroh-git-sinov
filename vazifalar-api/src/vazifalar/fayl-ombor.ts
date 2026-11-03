// fayl-ombor.ts — VazifaOmbori JSON faylda: o'qish xotiradan (XotiraOmbori), har yozuvdan keyin butun holat diskka ATOMIK yoziladi
// (vaqtinchalik fayl + rename — 24-qism #17: oddiy yozish 17/20 buzildi, temp+rename 0/20). Bitta jarayon uchun; ko'p jarayon — Postgres (26-qism)
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { XotiraOmbori } from "./xotira-ombor.ts";
import type { Surat } from "./xotira-ombor.ts";
import type { AlmashtirishVazifasi, Filtr, RoyxatNatija, RoyxatSorovi, Shart, TegSoni, VazifaOmbori, YozishNatijasi } from "./ombor.ts";
import type { Vazifa, VazifaOzgarishi, YangiVazifa } from "./vazifa.ts";

function suratmi(x: unknown): x is Surat {
  return typeof x === "object" && x !== null && "keyingiId" in x && "versiya" in x && "vazifalar" in x && Array.isArray(x.vazifalar);
}

export class FaylOmbori implements VazifaOmbori {
  readonly #xotira: XotiraOmbori;
  readonly #yol: string;
  /** yozuvlar navbati: ikki yozish bir vaqtda rename qilmasin (Windows'da EPERM) */
  #navbat: Promise<void> = Promise.resolve();

  private constructor(yol: string, xotira: XotiraOmbori) {
    this.#yol = yol;
    this.#xotira = xotira;
  }

  /** Fayl yo'q bo'lsa — bo'sh ombor; buzilgan bo'lsa — XATO (jim yo'qotmaymiz: ma'lumot o'chib ketmasin) */
  static async och(yol: string, soat: () => Date = () => new Date()): Promise<FaylOmbori> {
    let matn: string | undefined;
    try {
      matn = await readFile(yol, "utf8");
    } catch (x) {
      if (!(x instanceof Error && "code" in x && x.code === "ENOENT")) throw x;
    }
    if (matn === undefined) return new FaylOmbori(yol, new XotiraOmbori(soat));
    const malumot: unknown = JSON.parse(matn);
    if (!suratmi(malumot)) throw new Error(`${yol}: vazifalar fayli tuzilmasi noto'g'ri`);
    return new FaylOmbori(yol, new XotiraOmbori(soat, malumot));
  }

  #saqla(): Promise<void> {
    const surat = this.#xotira.surat();
    const vaqtinchalik = `${this.#yol}.${String(process.pid)}.tmp`;
    this.#navbat = this.#navbat.then(async () => {
      await mkdir(dirname(this.#yol), { recursive: true });
      try {
        await writeFile(vaqtinchalik, JSON.stringify(surat), { mode: 0o600 });
        await rename(vaqtinchalik, this.#yol);
      } catch (x) {
        await rm(vaqtinchalik, { force: true });
        throw x;
      }
    });
    return this.#navbat;
  }

  async #yoz<T>(amal: Promise<T>): Promise<T> {
    const natija = await amal;
    await this.#saqla(); // diskka yozilmaguncha javob qaytmaydi — "saqlandi" degan javob yolg'on bo'lmasin
    return natija;
  }

  royxat(sorov: RoyxatSorovi): Promise<RoyxatNatija> {
    return this.#xotira.royxat(sorov);
  }
  soni(filtr: Filtr): Promise<number> {
    return this.#xotira.soni(filtr);
  }
  ol(id: number): Promise<Vazifa | undefined> {
    return this.#xotira.ol(id);
  }
  teglar(): Promise<TegSoni[]> {
    return this.#xotira.teglar();
  }
  yarat(yangi: YangiVazifa): Promise<Vazifa> {
    return this.#yoz(this.#xotira.yarat(yangi));
  }
  yangila(id: number, ozgarish: VazifaOzgarishi, shart?: Shart): Promise<YozishNatijasi<Vazifa>> {
    return this.#yoz(this.#xotira.yangila(id, ozgarish, shart));
  }
  ochir(id: number, shart?: Shart): Promise<YozishNatijasi<null>> {
    return this.#yoz(this.#xotira.ochir(id, shart));
  }
  almashtirHammasi(vazifalar: readonly AlmashtirishVazifasi[]): Promise<{ vazifalar: Vazifa[]; versiya: number }> {
    return this.#yoz(this.#xotira.almashtirHammasi(vazifalar));
  }
}
