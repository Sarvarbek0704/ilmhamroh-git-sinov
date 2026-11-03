// ombor.ts — repository interfeysi: xizmat saqlash qanday ishlashini bilmaydi.
// Hamma metod async — 26-qismda Postgres (pg) bilan almashganda chaqiruvchi kod o'zgarmaydi
import type { Vazifa, VazifaOzgarishi, YangiVazifa } from "./vazifa.ts";

/** Saralash mumkin bo'lgan maydonlar (oq ro'yxat — SQL'da ustun nomi bo'ladi, foydalanuvchi matni emas) */
export const SARALASH_MAYDONLARI = ["id", "tartib", "matn", "bajarildi", "yaratildi", "yangilandi"] as const;
export type SaralashMaydoni = (typeof SARALASH_MAYDONLARI)[number];
export type Saralash = { maydon: SaralashMaydoni; kamayish: boolean };

export type Filtr = {
  bajarildi?: boolean;
  /** hammasi bo'lishi kerak (AND), kichik harfda */
  teglar?: string[];
  /** matn ichida, katta-kichik harfsiz */
  qidiruv?: string;
  /** yaratildi >= (UTC ISO lahza) */
  yaratildiDan?: string;
  /** yaratildi < (UTC ISO lahza, chegarasiz) */
  yaratildiGacha?: string;
};

/** Keyset kursori: oxirgi qatorning saralash kalitlari qiymatlari (saralash tartibida) + id */
export type KursorQiymati = (string | number | boolean)[];

export type Sahifalash = { tur: "offset"; offset: number } | { tur: "kursor"; keyin?: KursorQiymati };

export type RoyxatSorovi = {
  filtr: Filtr;
  /** bo'sh bo'lsa — tartib, keyin id bo'yicha o'sish; ombor oxiriga doim id qo'shadi (barqaror tartib) */
  saralash: Saralash[];
  limit: number;
  sahifa: Sahifalash;
  /** jami sonini ham hisoblash (Postgres'da alohida COUNT — qimmat) */
  jami?: boolean;
};

export type RoyxatNatija = {
  vazifalar: Vazifa[];
  /** keyingi sahifa bormi — kursor rejimida keyingi kursor qiymatlari */
  keyingi?: KursorQiymati;
  borKeyingi: boolean;
  jami?: number;
  /** butun to'plam versiyasi (har yozuvda +1) — frontend sinxroni (22-qism `versiya`) va ro'yxat ETag'i uchun */
  versiya: number;
};

export type TegSoni = { teg: string; soni: number };

/** Optimistic concurrency: yozuv faqat versiya mos kelsa (If-Match). Postgres'da: UPDATE ... WHERE id = $1 AND versiya = $2 */
export type Shart = { versiya: number };
export type YozishNatijasi<T> = { tur: "ok"; qiymat: T } | { tur: "topilmadi" } | { tur: "konflikt"; joriy: Vazifa };

export interface VazifaOmbori {
  royxat(sorov: RoyxatSorovi): Promise<RoyxatNatija>;
  /** filtrga mos vazifalar soni (limit va sahifasiz) */
  soni(filtr: Filtr): Promise<number>;
  ol(id: number): Promise<Vazifa | undefined>;
  yarat(yangi: YangiVazifa): Promise<Vazifa>;
  /** versiya 1 ga oshadi, yangilandi = hozir; shart berilsa va versiya boshqa — "konflikt" */
  yangila(id: number, ozgarish: VazifaOzgarishi, shart?: Shart): Promise<YozishNatijasi<Vazifa>>;
  ochir(id: number, shart?: Shart): Promise<YozishNatijasi<null>>;
  /** teglar va nechta vazifada — ko'pidan kamiga */
  teglar(): Promise<TegSoni[]>;
  /** Butun to'plamni almashtirish (PUT /v1/vazifalar, frontend importi): berilgan yaroqli takrorlanmas id saqlanadi, qolganiga yangi id. Atomik */
  almashtirHammasi(vazifalar: readonly AlmashtirishVazifasi[]): Promise<{ vazifalar: Vazifa[]; versiya: number }>;
}

export type AlmashtirishVazifasi = { id?: number | undefined; matn: string; bajarildi: boolean };

/** Foydalanuvchi id → shu foydalanuvchining ombori (Postgres: PgOmbori(pool, id) — arzon obyekt, ulanish pool'da). 28-qism #07 */
export type OmborFabrikasi = (egasiId: number) => VazifaOmbori;
