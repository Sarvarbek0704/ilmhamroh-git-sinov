// vazifa.ts — vazifa modeli va teglar. Kiruvchi ma'lumot turlari — Zod sxemalaridan (sxema.ts, z.infer): tur qo'lda takrorlanmaydi
import type { z } from "zod";
import type { OzgarishSxemasi, ToliqVazifaSxemasi, YangiVazifaSxemasi } from "./sxema.ts";

export type Vazifa = {
  id: number;
  matn: string;
  bajarildi: boolean;
  /** matndagi #teglar — server o'zi ajratadi (frontend'dagi qoida bilan bir xil) */
  teglar: string[];
  /** ISO 8601, UTC (Z bilan) */
  yaratildi: string;
  yangilandi: string;
  /** ro'yxatdagi o'rni (frontend sudrab tartiblaydi → PUT /v1/vazifalar massiv tartibi); sukut saralash shu bo'yicha */
  tartib: number;
  /** har o'zgarishda +1 — ETag va If-Match (optimistic concurrency) shundan */
  versiya: number;
};

export type YangiVazifa = z.output<typeof YangiVazifaSxemasi>;
/** PUT — to'liq almashtirish: hamma yoziladigan maydon majburiy */
export type ToliqVazifa = z.output<typeof ToliqVazifaSxemasi>;
export type VazifaOzgarishi = z.output<typeof OzgarishSxemasi>;

// Frontend (22-qism, royxat.ts) bilan bir xil: # dan keyin harf/raqam/_, apostrof faqat harflar orasida
const TEG = /(?<![\p{L}\p{N}_#])#[\p{L}\p{N}_]+(?:['‘’][\p{L}\p{N}_]+)*/gu;

export function teglariniOl(matn: string): string[] {
  return [...new Set((matn.match(TEG) ?? []).map((t) => t.slice(1).toLowerCase()))];
}
