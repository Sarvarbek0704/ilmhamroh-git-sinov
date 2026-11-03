// xotira-ombor.ts — VazifaOmbori ning xotiradagi amalga oshirilishi (jarayon to'xtasa — ma'lumot yo'qoladi)
import { teglariniOl } from "./vazifa.ts";
import type { Vazifa, VazifaOzgarishi, YangiVazifa } from "./vazifa.ts";
import { filtrla, sahifala } from "./royxat-mantiq.ts";
import type { AlmashtirishVazifasi, Filtr, RoyxatNatija, RoyxatSorovi, Shart, TegSoni, VazifaOmbori, YozishNatijasi } from "./ombor.ts";

/** Ombor holatining nusxasi — fayl ombori shuni diskka yozadi */
export type Surat = { keyingiId: number; versiya: number; vazifalar: Vazifa[] };

export class XotiraOmbori implements VazifaOmbori {
  readonly #vazifalar = new Map<number, Vazifa>();
  #keyingiId = 1;
  /** to'plam versiyasi: har yozuvda +1 */
  #versiya = 0;
  readonly #soat: () => Date;

  constructor(soat: () => Date = () => new Date(), surat?: Surat) {
    this.#soat = soat;
    if (surat !== undefined) {
      for (const v of surat.vazifalar) this.#vazifalar.set(v.id, structuredClone(v));
      this.#keyingiId = surat.keyingiId;
      this.#versiya = surat.versiya;
    }
  }

  surat(): Surat {
    return { keyingiId: this.#keyingiId, versiya: this.#versiya, vazifalar: structuredClone([...this.#vazifalar.values()]) };
  }

  // structuredClone (sahifala ichida ham): chaqiruvchi qaytgan obyektni o'zgartirsa ombordagi nusxa buzilmaydi
  royxat(sorov: RoyxatSorovi): Promise<RoyxatNatija> {
    return Promise.resolve({ ...sahifala([...this.#vazifalar.values()], sorov), versiya: this.#versiya });
  }

  soni(filtr: Filtr): Promise<number> {
    return Promise.resolve(filtrla([...this.#vazifalar.values()], filtr).length);
  }

  ol(id: number): Promise<Vazifa | undefined> {
    const v = this.#vazifalar.get(id);
    return Promise.resolve(v && structuredClone(v));
  }

  yarat(yangi: YangiVazifa): Promise<Vazifa> {
    const hozir = this.#soat().toISOString();
    const v: Vazifa = {
      id: this.#keyingiId++,
      matn: yangi.matn,
      bajarildi: yangi.bajarildi ?? false,
      teglar: teglariniOl(yangi.matn),
      yaratildi: hozir,
      yangilandi: hozir,
      tartib: Math.max(0, ...[...this.#vazifalar.values()].map((t) => t.tartib)) + 1,
      versiya: 1,
    };
    this.#vazifalar.set(v.id, v);
    this.#versiya++;
    return Promise.resolve(structuredClone(v));
  }

  yangila(id: number, ozgarish: VazifaOzgarishi, shart?: Shart): Promise<YozishNatijasi<Vazifa>> {
    const v = this.#vazifalar.get(id);
    if (!v) return Promise.resolve({ tur: "topilmadi" });
    if (shart !== undefined && shart.versiya !== v.versiya) return Promise.resolve({ tur: "konflikt", joriy: structuredClone(v) });
    if (ozgarish.matn !== undefined) {
      v.matn = ozgarish.matn;
      v.teglar = teglariniOl(ozgarish.matn);
    }
    if (ozgarish.bajarildi !== undefined) v.bajarildi = ozgarish.bajarildi;
    v.yangilandi = this.#soat().toISOString();
    v.versiya++;
    this.#versiya++;
    return Promise.resolve({ tur: "ok", qiymat: structuredClone(v) });
  }

  ochir(id: number, shart?: Shart): Promise<YozishNatijasi<null>> {
    const v = this.#vazifalar.get(id);
    if (!v) return Promise.resolve({ tur: "topilmadi" });
    if (shart !== undefined && shart.versiya !== v.versiya) return Promise.resolve({ tur: "konflikt", joriy: structuredClone(v) });
    this.#vazifalar.delete(id);
    this.#versiya++;
    return Promise.resolve({ tur: "ok", qiymat: null });
  }

  almashtirHammasi(yangilar: readonly AlmashtirishVazifasi[]): Promise<{ vazifalar: Vazifa[]; versiya: number }> {
    const hozir = this.#soat().toISOString();
    const band = new Set<number>();
    for (const y of yangilar) if (y.id !== undefined && !band.has(y.id)) band.add(y.id);
    let keyingi = Math.max(this.#keyingiId, ...[...band].map((id) => id + 1));
    const ishlatildi = new Set<number>();
    const eski = this.#vazifalar;
    const yangi = new Map<number, Vazifa>();
    for (const [i, y] of yangilar.entries()) {
      const id = y.id !== undefined && !ishlatildi.has(y.id) ? y.id : keyingi++;
      ishlatildi.add(id);
      const avval = eski.get(id);
      yangi.set(id, {
        id,
        matn: y.matn,
        bajarildi: y.bajarildi,
        teglar: teglariniOl(y.matn),
        yaratildi: avval?.yaratildi ?? hozir,
        yangilandi: hozir,
        tartib: i + 1,
        versiya: (avval?.versiya ?? 0) + 1,
      });
    }
    eski.clear();
    for (const [id, v] of yangi) eski.set(id, v);
    this.#keyingiId = keyingi;
    this.#versiya++;
    return Promise.resolve({ vazifalar: structuredClone([...yangi.values()]), versiya: this.#versiya });
  }

  teglar(): Promise<TegSoni[]> {
    const sanoq = new Map<string, number>();
    for (const v of this.#vazifalar.values()) for (const t of v.teglar) sanoq.set(t, (sanoq.get(t) ?? 0) + 1);
    return Promise.resolve(
      [...sanoq].map(([teg, soni]) => ({ teg, soni })).sort((a, b) => b.soni - a.soni || (a.teg < b.teg ? -1 : 1)),
    );
  }
}
