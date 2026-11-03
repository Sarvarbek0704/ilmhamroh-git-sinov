// eksport.service.ts — uzoq davom etuvchi operatsiya (25-qism eksport.ts mantiqi): ishlar xotirada (bitta jarayon), fonda bajariladi.
// Provider sukut bo'yicha SINGLETON — `ishlar` Map'i hamma so'rovlar uchun bitta (#10)
import { randomUUID } from "node:crypto";
import { setImmediate as navbat } from "node:timers/promises";
import { Inject, Injectable } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { IlovaXatosi } from "../umumiy/xatolar.ts";
import { csvQator } from "../umumiy/csv.ts";
import { joriyLog } from "../umumiy/log.ts";
import type { Log } from "../umumiy/log.ts";
import { ClsService } from "nestjs-cls";
import { CLS_EGASI, LOG, OMBOR_FABRIKASI } from "../tokenlar.ts";
import type { KursorQiymati, OmborFabrikasi } from "../vazifalar/ombor.ts";
import type { EksportSorovi } from "../vazifalar/sxema.ts";
import type { Vazifa } from "../vazifalar/vazifa.ts";

export type EksportHolati = "kutilmoqda" | "bajarilmoqda" | "tayyor" | "xato";
/** egasi — ishni kim yaratdi: boshqa foydalanuvchi id'ni bilsa ham ko'ra olmaydi (BOLA, 28 #07) */
export type Ish = { id: string; egasi: number; sorov: EksportSorovi; holat: EksportHolati; yaratildi: string; tayyor: number; jami: number; natija?: string; xato?: string; tugash: number };

const USTUNLAR = ["id", "matn", "bajarildi", "teglar", "yaratildi", "yangilandi"] as const;
const SAQLASH_MS = 60 * 60 * 1000; // natija 1 soat saqlanadi
const BOLAK = 100;

/** discriminatedUnion natijasi: sorov.format bo'yicha TS har tarmoqda to'g'ri turni biladi (ajratgich faqat csv'da) */
function yoz(sorov: EksportSorovi, vazifalar: readonly Vazifa[], birinchi: boolean): string {
  if (sorov.format === "json") return vazifalar.map((v, i) => (birinchi && i === 0 ? "" : ",") + JSON.stringify(v)).join("");
  return vazifalar.map((v) => csvQator([v.id, v.matn, v.bajarildi, v.teglar.join(" "), v.yaratildi, v.yangilandi], sorov.ajratgich)).join("");
}

@Injectable()
export class EksportService {
  readonly #ishlar = new Map<string, Ish>();
  /** tikuvlar (seam): testda soxta soat */
  soat: () => number = Date.now;

  constructor(
    @Inject(OMBOR_FABRIKASI) private readonly fabrika: OmborFabrikasi,
    private readonly cls: ClsService,
    @Inject(LOG) private readonly log: Log,
  ) {}

  #egasi(): number {
    const e = this.cls.get<number | undefined>(CLS_EGASI);
    if (e === undefined) throw new Error("so'rov egasi aniqlanmagan (CLS)");
    return e;
  }

  boshla(sorov: EksportSorovi): Ish {
    const ish: Ish = { id: randomUUID(), egasi: this.#egasi(), sorov, holat: "kutilmoqda", yaratildi: new Date(this.soat()).toISOString(), tayyor: 0, jami: 0, tugash: this.soat() + SAQLASH_MS };
    this.#ishlar.set(ish.id, ish);
    // Javob kutmaydi: ish fonda; xatosi ish holatiga yoziladi (yutib yuborilmaydi). Fon ishi ham shu so'rov konteksti (sorovId) bilan loglanadi
    const l = joriyLog(this.log);
    this.#bajar(ish).then(
      () => { l.info({ eksportId: ish.id, soni: ish.tayyor }, "eksport tayyor"); },
      (x: unknown) => {
        ish.holat = "xato";
        ish.xato = "Eksport bajarilmadi";
        l.error({ err: x, eksportId: ish.id }, "eksport bajarilmadi");
      },
    );
    return ish;
  }

  async #bajar(ish: Ish): Promise<void> {
    ish.holat = "bajarilmoqda";
    // fon ishi: ombor ish egasi bilan (RLS) — so'rov tugagandan keyin ham
    const ombor = this.fabrika(ish.egasi);
    ish.jami = await ombor.soni({});
    let chiqish = ish.sorov.format === "json" ? "[" : csvQator(USTUNLAR, ish.sorov.ajratgich);
    let keyin: KursorQiymati | undefined;
    for (;;) {
      const n = await ombor.royxat({ filtr: {}, saralash: [], limit: BOLAK, sahifa: keyin === undefined ? { tur: "kursor" } : { tur: "kursor", keyin } });
      chiqish += yoz(ish.sorov, n.vazifalar, ish.tayyor === 0);
      ish.tayyor += n.vazifalar.length;
      if (!n.borKeyingi || n.keyingi === undefined) break;
      keyin = n.keyingi;
      await navbat(); // event loop'ni bo'shatamiz — boshqa so'rovlar kutib qolmasin
    }
    ish.natija = ish.sorov.format === "json" ? chiqish + "]" : chiqish;
    ish.holat = "tayyor";
    ish.tugash = this.soat() + SAQLASH_MS;
  }

  /**
   * #48: muddati o'tgan ishlar har daqiqada o'chiriladi (avval — har topilsin() chaqiruvida butun Map aylanardi). Bitta jarayon ichida;
   * N nusxa (instans) bo'lsa har biri o'z xotirasini tozalaydi — ishlarning o'zi ham nusxaga bog'liq (umumiy navbat — 29-qism, BullMQ)
   */
  @Interval("eksport-tozalash", 60_000)
  tozala(): number {
    let n = 0;
    for (const [k, i] of this.#ishlar) if (i.tugash <= this.soat()) { this.#ishlar.delete(k); n++; }
    return n;
  }

  topilsin(id: string): Ish {
    const ish = this.#ishlar.get(id);
    // interval kelgunicha muddati o'tgan ish ham ko'rinmasin
    if (ish === undefined || ish.tugash <= this.soat() || ish.egasi !== this.#egasi()) throw new IlovaXatosi(404, `Eksport ${id} topilmadi (yoki muddati o'tgan)`, { kod: "eksport-topilmadi", sarlavha: "Eksport topilmadi" });
    return ish;
  }

  korinish(ish: Ish, asos: string): Record<string, unknown> {
    const k: Record<string, unknown> = { id: ish.id, format: ish.sorov.format, holat: ish.holat, yaratildi: ish.yaratildi, tayyor: ish.tayyor, jami: ish.jami };
    if (ish.holat === "tayyor") k.fayl = `${asos}/${ish.id}/fayl`;
    if (ish.xato !== undefined) k.xato = ish.xato;
    return k;
  }
}
