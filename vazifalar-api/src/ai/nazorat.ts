// nazorat.ts — 31-qism #19 (B-210): AI xususiyatini prodakshnda boshqarish — javob keshi, kvota, hodisa (statistika) bir joyda.
//   Kesh: bir xil (foydalanuvchi, model, prompt versiyasi, matn) — bir xil javob; LLM qayta chaqirilmaydi, kvota sarflanmaydi. Kalit foydalanuvchi bo'yicha
//   (30-qism #46 saboq: umumiy kalitli kesh — begona javob/zaharlash xavfi). Redis bo'lsa — Redis (TTL), bo'lmasa — jarayon xotirasi (LRU emas, oddiy chegara).
//   Hodisa: vazifa_hodisalari (301) ga `ai_qadamlar` / `ai_savol` / `semantik_qidiruv` — MATNSIZ (model, tokenlar, kesh).
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { egasiSifatida } from "../umumiy/rls.ts";
import type { RedisKlient } from "../ombor-yarat.ts";
import type { AiKvota } from "./kvota.ts";

export interface AiKesh {
  ol(kalit: string): Promise<string | undefined>;
  yoz(kalit: string, qiymat: string, ttlS: number): Promise<void>;
}

export class XotiraKesh implements AiKesh {
  readonly #m = new Map<string, { q: string; tugash: number }>();
  constructor(private readonly maks = 1000) {}
  ol(k: string): Promise<string | undefined> {
    const x = this.#m.get(k);
    if (x === undefined || x.tugash < Date.now()) { this.#m.delete(k); return Promise.resolve(undefined); }
    return Promise.resolve(x.q);
  }
  yoz(k: string, q: string, ttlS: number): Promise<void> {
    if (this.#m.size >= this.maks) this.#m.delete(this.#m.keys().next().value ?? "");
    this.#m.set(k, { q, tugash: Date.now() + ttlS * 1000 });
    return Promise.resolve();
  }
}

export class RedisKesh implements AiKesh {
  constructor(private readonly r: RedisKlient) {}
  async ol(k: string): Promise<string | undefined> {
    return (await this.r.get(k)) ?? undefined;
  }
  async yoz(k: string, q: string, ttlS: number): Promise<void> {
    await this.r.set(k, q, { EX: ttlS });
  }
}

export const keshKaliti = (egasi: number, ...qismlar: string[]): string =>
  `vz:ai:${String(egasi)}:${createHash("sha256").update(qismlar.join("\u0000")).digest("base64url")}`;

export type AiHodisa = "ai_qadamlar" | "ai_savol" | "semantik_qidiruv";

export type AiNazorat = {
  kvota?: AiKvota | undefined;
  kesh?: AiKesh | undefined;
  /** kesh yashash vaqti, s (sukut 7 kun) */
  keshTtlS?: number;
  pool?: Pool | undefined;
};

/** statistika hodisasi (matnsiz). Xato — asosiy javobni buzmaydi (log faqat chaqiruvchida) */
export async function aiHodisa(pool: Pool | undefined, egasi: number, tur: AiHodisa, vazifaId: number | null, malumot: Record<string, unknown>): Promise<void> {
  if (pool === undefined) return;
  await egasiSifatida(pool, egasi, (c) => c.query("INSERT INTO vazifa_hodisalari (egasi_id, vazifa_id, tur, malumot) VALUES ($1, $2, $3, $4)", [egasi, vazifaId, tur, malumot]));
}

/** LLM chaqiruvini kvota bilan o'raydi: oldin band, provayder (vaqtinchalik/ichki) xatosida qaytariladi, keyin tokenlar qo'shiladi */
export async function kvotaBilan<T extends { tokenlar: { kirish: number; chiqish: number } }>(kvota: AiKvota | undefined, egasi: number, fn: () => Promise<T>): Promise<T> {
  if (kvota === undefined) return fn();
  await kvota.band(egasi);
  let natija: T;
  try {
    natija = await fn();
  } catch (x) {
    await kvota.qaytar(egasi);
    throw x;
  }
  await kvota.tokenQosh(egasi, natija.tokenlar.kirish + natija.tokenlar.chiqish);
  return natija;
}
