// api-kalit.ts — #22 B-126 (holat 22): API kalitlari (foydalanuvchi nomidan dastur) va servislararo HMAC imzo (bot, ichki xizmat — kalitsiz, umumiy sir bilan).
// API kalit: "Authorization: Bearer vz_<prefiks>_<sir>". Prefiks — bazadan topish (indeks) va loglarda/ro'yxatda ko'rsatish; sir — faqat HMAC solishtiriladi.
// Ruxsatlar (scope): vazifalar:oqish, vazifalar:yozish. Kalit bilan auth yo'llari (sessiyalar, kalitlar, admin, parol) — YO'Q: ular faqat sessiya bilan.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import type { RequestHandler } from "express";
import { TURLAR } from "../vazifalar/pg-ombor.ts";
import { IlovaXatosi } from "../umumiy/xatolar.ts";

export const RUXSATLAR = ["vazifalar:oqish", "vazifalar:yozish"] as const;
export type Ruxsat = (typeof RUXSATLAR)[number];
export type KalitEgasi = { id: number; foydalanuvchiId: number; ruxsatlar: Ruxsat[] };

const KALIT = /^vz_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/;
const ALIFBO = "abcdefghijklmnopqrstuvwxyz0123456789";

export class ApiKalitlar {
  readonly #pool: Pool;
  readonly #kalit: Buffer;

  constructor(pool: Pool, kalit: Buffer) {
    this.#pool = pool;
    this.#kalit = kalit;
  }

  async #sorov<T extends QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
    return (await this.#pool.query<T>({ text, values, types: TURLAR })).rows;
  }

  #hmac(sir: string): Buffer {
    return createHmac("sha256", this.#kalit).update(sir).digest();
  }

  /** @returns to'liq kalit (BIR MARTA ko'rsatiladi) */
  async yarat(fid: number, nom: string, ruxsatlar: readonly Ruxsat[], muddatKun?: number): Promise<{ id: number; prefiks: string; kalit: string }> {
    const prefiks = Array.from(randomBytes(8), (b) => ALIFBO[b % 36]).join(""); // 36^8 ≈ 2.8·10^12 — to'qnashsa UNIQUE xatosi (amalda yo'q)
    const sir = randomBytes(32).toString("base64url");
    const [q] = await this.#sorov<{ id: number }>(
      `INSERT INTO api_kalitlar (foydalanuvchi_id, prefiks, kalit_hmac, nom, ruxsatlar, tugash_vaqti)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::int IS NULL THEN NULL ELSE now() + $6::int * interval '1 day' END) RETURNING id`,
      [fid, prefiks, this.#hmac(sir), nom, ruxsatlar, muddatKun ?? null]);
    if (q === undefined) throw new Error("kalit yaratilmadi");
    return { id: q.id, prefiks, kalit: `vz_${prefiks}_${sir}` };
  }

  /** Bearer kalit → egasi va ruxsatlari (faol, muddati o'tmagan, egasi bloklanmagan); oxirgi_ishlatish 60 s qadam bilan */
  async tekshir(kalit: string): Promise<KalitEgasi | undefined> {
    const m = KALIT.exec(kalit);
    if (m === null) return undefined;
    const [q] = await this.#sorov<{ id: number; fid: number; h: Buffer; r: Ruxsat[]; eski: boolean }>(
      `SELECT k.id, k.foydalanuvchi_id AS fid, k.kalit_hmac AS h, k.ruxsatlar AS r, coalesce(k.oxirgi_ishlatish < now() - interval '60 seconds', true) AS eski
       FROM api_kalitlar k JOIN foydalanuvchilar f ON f.id = k.foydalanuvchi_id
       WHERE k.prefiks = $1 AND k.bekor_vaqti IS NULL AND (k.tugash_vaqti IS NULL OR k.tugash_vaqti > now()) AND f.bloklangan_vaqt IS NULL`, [m[1]]);
    if (q === undefined || !timingSafeEqual(q.h, this.#hmac(m[2] ?? ""))) return undefined;
    if (q.eski) await this.#pool.query("UPDATE api_kalitlar SET oxirgi_ishlatish = now() WHERE id = $1", [q.id]);
    return { id: q.id, foydalanuvchiId: q.fid, ruxsatlar: q.r };
  }

  async royxat(fid: number): Promise<Record<string, unknown>[]> {
    return this.#sorov(
      `SELECT id, nom, 'vz_' || prefiks || '_…' AS korinish, ruxsatlar, yaratilgan_vaqt AS yaratilgan, tugash_vaqti AS tugash, oxirgi_ishlatish AS "oxirgiIshlatish"
       FROM api_kalitlar WHERE foydalanuvchi_id = $1 AND bekor_vaqti IS NULL ORDER BY id`, [fid]);
  }

  async bekor(fid: number, id: number): Promise<boolean> {
    const r = await this.#pool.query("UPDATE api_kalitlar SET bekor_vaqti = now() WHERE id = $1 AND foydalanuvchi_id = $2 AND bekor_vaqti IS NULL", [id, fid]);
    return r.rowCount === 1;
  }

  /** Aylantirish: yangi kalit (o'sha nom va ruxsatlar), eskisi `oraliqSoat` dan keyin o'ladi — integratsiyani yangilashga vaqt */
  async aylantir(fid: number, id: number, oraliqSoat = 24): Promise<{ id: number; prefiks: string; kalit: string } | undefined> {
    const [e] = await this.#sorov<{ nom: string; r: Ruxsat[] }>(
      `UPDATE api_kalitlar SET tugash_vaqti = LEAST(coalesce(tugash_vaqti, 'infinity'), now() + $3 * interval '1 hour')
       WHERE id = $1 AND foydalanuvchi_id = $2 AND bekor_vaqti IS NULL RETURNING nom, ruxsatlar AS r`, [id, fid, oraliqSoat]);
    return e === undefined ? undefined : this.yarat(fid, e.nom, e.r);
  }
}

// --- servislararo HMAC imzo ---
export class ImzoXatosi extends IlovaXatosi {
  constructor(sabab: string) {
    super(401, `Imzo yaroqsiz (${sabab})`, { kod: "imzo-xato", sarlavha: "Imzo yaroqsiz" });
  }
}

/**
 * Imzolanadigan satr: METOD \n YO'L(+query) \n VAQT(unix s) \n NONCE \n sha256(tana) hex. Sarlavhalar: X-Vaqt, X-Nonce, X-Imzo (hex HMAC-SHA256).
 * Himoya: soxtalashtirish (HMAC), tanani o'zgartirish (hash), qayta o'ynatish (vaqt oynasi ±5 daqiqa + nonce xotirada oyna davomida).
 */
export function imzoSatri(metod: string, yol: string, vaqt: string, nonce: string, tana: Buffer | string): string {
  return [metod.toUpperCase(), yol, vaqt, nonce, createHash("sha256").update(tana).digest("hex")].join("\n");
}

export function hmacImzo(sir: Buffer, satr: string): string {
  return createHmac("sha256", sir).update(satr).digest("hex");
}

export function servisImzosi(sir: Buffer, oynaS = 300, soat: () => number = Date.now): RequestHandler {
  const korilgan = new Map<string, number>(); // nonce → muddati; bitta jarayon (ko'p nusxada — Redis SET NX, 27 #60)
  return (req, _res, next) => {
    const vaqt = req.get("x-vaqt") ?? "";
    const nonce = req.get("x-nonce") ?? "";
    const imzo = req.get("x-imzo") ?? "";
    if (!/^\d{10}$/.test(vaqt) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(imzo)) throw new ImzoXatosi("sarlavhalar");
    const hozir = Math.floor(soat() / 1000);
    if (Math.abs(hozir - Number(vaqt)) > oynaS) throw new ImzoXatosi("vaqt");
    const kutilgan = Buffer.from(hmacImzo(sir, imzoSatri(req.method, req.originalUrl, vaqt, nonce, req.xomTana ?? Buffer.alloc(0))), "hex");
    if (!timingSafeEqual(kutilgan, Buffer.from(imzo, "hex"))) throw new ImzoXatosi("imzo");
    for (const [k, t] of korilgan) if (t < hozir) korilgan.delete(k);
    if (korilgan.has(nonce)) throw new ImzoXatosi("takror");
    korilgan.set(nonce, hozir + 2 * oynaS);
    next();
  };
}
