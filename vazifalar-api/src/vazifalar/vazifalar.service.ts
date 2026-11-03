// vazifalar.service.ts — biznes qoidalari (25-qism xizmat.ts dan; mantiq o'zgarmadi). Endi factory funksiya emas — @Injectable klass:
// bog'liqliklarni Nest konteyneri constructor orqali beradi (ombor — token bilan, chunki VazifaOmbori — interfeys)
import { Inject, Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { IlovaXatosi, KonfliktXatosi, ShartXatosi, TopilmadiXatosi } from "../umumiy/xatolar.ts";
import { joriyLog } from "../umumiy/log.ts";
import type { Log } from "../umumiy/log.ts";
import { ClsService } from "nestjs-cls";
import { CLS_EGASI, LOG, OMBOR_FABRIKASI } from "../tokenlar.ts";
import type { AlmashtirishVazifasi, OmborFabrikasi, RoyxatNatija, RoyxatSorovi, Shart, TegSoni, VazifaOmbori, YozishNatijasi } from "./ombor.ts";
import type { ToliqVazifa, Vazifa, VazifaOzgarishi, YangiVazifa } from "./vazifa.ts";

export const MAKS_VAZIFA = 1000;

/** Domen hodisalari (#49): xizmat KIM tinglashini bilmaydi — webhook (vazifalar.tinglovchi.ts), SSE oqimi (#53), 29-qismda bot/email */
export const HODISA = { yaratildi: "vazifa.yaratildi", yangilandi: "vazifa.yangilandi", bajarildi: "vazifa.bajarildi", ochirildi: "vazifa.ochirildi", almashtirildi: "vazifa.royxat-almashtirildi" } as const;

export type ToplamNatija = { ok: true; vazifa: Vazifa } | { ok: false; xato: IlovaXatosi };
const topilmadi = (id: number) => new TopilmadiXatosi(`Vazifa ${String(id)} topilmadi`, "vazifa-topilmadi", "Vazifa topilmadi");

/** Ombor natijasini qiymatga yoki xatoga aylantiradi: topilmadi → 404, versiya mos emas → 412 */
function natija<T>(id: number, n: YozishNatijasi<T>): T {
  if (n.tur === "topilmadi") throw topilmadi(id);
  if (n.tur === "konflikt") {
    throw new ShartXatosi(`Vazifa ${String(id)} boshqa so'rov bilan o'zgargan (joriy versiya ${String(n.joriy.versiya)}) — qayta o'qing`, `"${String(n.joriy.versiya)}"`);
  }
  return n.qiymat;
}

@Injectable()
export class VazifalarService {
  constructor(
    // B (28 RLS): ombor HAR SO'ROV egasi bilan — fabrika + CLS'dagi egasi (ilova.ts middleware'i qo'yadi). REQUEST scope emas: u butun
    // zanjirni (controller, xizmat) har so'rovda qayta yaratadi (holat 36 o'lchovi: -43% RPS)
    @Inject(OMBOR_FABRIKASI) private readonly fabrika: OmborFabrikasi,
    private readonly cls: ClsService,
    @Inject(LOG) private readonly log: Log,
    // holat 51: webhook to'g'ridan chaqirilmaydi — hodisa chiqariladi (emit sinxron: tinglovchilar shu so'rov kontekstida, sorovId bilan)
    private readonly hodisalar: EventEmitter2,
  ) {}

  /** joriy so'rov egasi (sessiya / API kaliti / dev rejim EGASI_ID). Kontekstsiz chaqiruv — dasturchi xatosi */
  get egasi(): number {
    const e = this.cls.get<number | undefined>(CLS_EGASI);
    if (e === undefined) throw new Error("so'rov egasi aniqlanmagan (CLS)");
    return e;
  }

  private get ombor(): VazifaOmbori {
    return this.fabrika(this.egasi);
  }

  royxat(sorov: RoyxatSorovi): Promise<RoyxatNatija> {
    return this.ombor.royxat(sorov);
  }

  teglar(): Promise<TegSoni[]> {
    return this.ombor.teglar();
  }

  async ol(id: number): Promise<Vazifa> {
    const v = await this.ombor.ol(id);
    if (!v) throw topilmadi(id);
    return v;
  }

  async yarat(yangi: YangiVazifa): Promise<Vazifa> {
    if ((await this.ombor.soni({})) >= MAKS_VAZIFA) throw new KonfliktXatosi(`Ro'yxat to'lgan (${String(MAKS_VAZIFA)})`, { kod: "royxat-toldi", sarlavha: "Vazifalar soni chegarada" });
    const v = await this.ombor.yarat(yangi);
    // joriyLog — JORIY so'rov logger'i (AsyncLocalStorage): sorovId avtomatik qo'shiladi
    joriyLog(this.log).info({ vazifaId: v.id }, "vazifa yaratildi");
    this.hodisalar.emit(HODISA.yaratildi, v, this.egasi);
    return v;
  }

  async yangila(id: number, ozgarish: VazifaOzgarishi, shart?: Shart): Promise<Vazifa> {
    // Faqat false → true o'tishida "bajarildi": avvalgi holatni bilish kerak — qo'shimcha o'qish faqat tinglovchi bo'lsa
    const kuzatiladi = ozgarish.bajarildi === true && this.hodisalar.hasListeners(HODISA.bajarildi);
    const avval = kuzatiladi ? await this.ombor.ol(id) : undefined;
    const v = natija(id, await this.ombor.yangila(id, ozgarish, shart));
    this.hodisalar.emit(HODISA.yangilandi, v, this.egasi);
    if (avval?.bajarildi === false && v.bajarildi) this.hodisalar.emit(HODISA.bajarildi, v, this.egasi);
    return v;
  }

  /** PUT: butun resurs (matn va bajarildi) almashtiriladi — idempotent */
  almashtir(id: number, toliq: ToliqVazifa, shart?: Shart): Promise<Vazifa> {
    return this.yangila(id, toliq, shart);
  }

  /** PUT /v1/vazifalar — butun to'plam (frontend "almashtir") */
  async almashtirHammasi(vazifalar: readonly AlmashtirishVazifasi[]): Promise<{ vazifalar: Vazifa[]; versiya: number }> {
    const n = await this.ombor.almashtirHammasi(vazifalar);
    this.hodisalar.emit(HODISA.almashtirildi, { versiya: n.versiya, soni: n.vazifalar.length }, this.egasi);
    return n;
  }

  /** Bulk yaratish: yaroqlilari yaratiladi, qolganlari — xato bilan (qisman muvaffaqiyat) */
  /**
   * Holat 36 TUZATISH (25–27 dan qolgan xato, #35 da topildi): avval birinchi kutilgan xato (masalan takror matn — 409) butun so'rovni
   * yiqitardi, lekin undan OLDINGI elementlar bazada QOLARDI — mijoz 409 oladi, aslida yarim yozilgan. Endi har element o'z natijasi bilan
   * (207 — qisman muvaffaqiyat ma'nosi); kutilmagan xato (IlovaXatosi emas) — avvalgidek butun so'rov 500
   */
  async toplamYarat(yangilar: readonly YangiVazifa[]): Promise<ToplamNatija[]> {
    if ((await this.ombor.soni({})) + yangilar.length > MAKS_VAZIFA) throw new KonfliktXatosi(`Ro'yxat to'ladi (${String(MAKS_VAZIFA)})`, { kod: "royxat-toldi", sarlavha: "Vazifalar soni chegarada" });
    const natijalar: ToplamNatija[] = [];
    for (const y of yangilar) {
      try {
        const vazifa = await this.ombor.yarat(y);
        this.hodisalar.emit(HODISA.yaratildi, vazifa, this.egasi);
        natijalar.push({ ok: true, vazifa });
      } catch (x) {
        if (!(x instanceof IlovaXatosi)) throw x;
        natijalar.push({ ok: false, xato: x });
      }
    }
    return natijalar;
  }

  async ochir(id: number, shart?: Shart): Promise<void> {
    natija(id, await this.ombor.ochir(id, shart));
    joriyLog(this.log).info({ vazifaId: id }, "vazifa o'chirildi");
    this.hodisalar.emit(HODISA.ochirildi, { id }, this.egasi);
  }
}
