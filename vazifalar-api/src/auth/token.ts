// token.ts — #12 B-116 (holat 12): bir martalik tokenlar (email tasdiqlash, parol tiklash). Token — 32 bayt CSPRNG, bazada sha256, muddatli, bir marta.
// Ishlatish atomik: UPDATE … SET ishlatilgan_vaqt = now() WHERE hash = $1 AND ishlatilmagan AND muddati o'tmagan RETURNING — ikki parallel so'rovdan faqat bittasi oladi.
import { randomBytes } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import { TURLAR } from "../vazifalar/pg-ombor.ts";
import { tokenHash } from "./sessiya.ts";

export type Maqsad = "email_tasdiq" | "parol_tiklash";

/** Muddatlar: tasdiqlash xati — 24 soat, parol tiklash — 30 daqiqa (qisqa: xat qutisi o'g'irlansa ham oyna tor) */
export const MUDDAT_MS: Record<Maqsad, number> = { email_tasdiq: 24 * 3600_000, parol_tiklash: 30 * 60_000 };
/** Qayta yuborish oralig'i: shu vaqt ichida yangi xat yuborilmaydi (pochta qutisini to'ldirish va xarajatdan himoya) */
export const QAYTA_YUBORISH_MS = 60_000;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export class BirMartalikTokenlar {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async #sorov<T extends QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
    return (await this.#pool.query<T>({ text, values, types: TURLAR })).rows;
  }

  /**
   * Yangi token: shu maqsaddagi eski ishlatilmagan tokenlar bekor (oxirgi xatdagi havola ishlaydi, xolos).
   * @returns token yoki undefined — oxirgi xat QAYTA_YUBORISH_MS ichida yuborilgan (yangi xat kerak emas)
   */
  async yarat(foydalanuvchiId: number, maqsad: Maqsad, ip?: string): Promise<string | undefined> {
    const c = await this.#pool.connect();
    try {
      await c.query("BEGIN");
      // Foydalanuvchi qatori qulfi — parallel ikki so'rov ikkita xat yubormasin
      await c.query("SELECT 1 FROM foydalanuvchilar WHERE id = $1 FOR UPDATE", [foydalanuvchiId]);
      const { rows } = await c.query<{ yaqinda: boolean }>(
        "SELECT max(yaratilgan_vaqt) > now() - $3 * interval '1 millisecond' AS yaqinda FROM bir_martalik_tokenlar WHERE foydalanuvchi_id = $1 AND maqsad = $2",
        [foydalanuvchiId, maqsad, QAYTA_YUBORISH_MS]);
      if (rows[0]?.yaqinda === true) {
        await c.query("ROLLBACK");
        return undefined;
      }
      await c.query("UPDATE bir_martalik_tokenlar SET ishlatilgan_vaqt = now() WHERE foydalanuvchi_id = $1 AND maqsad = $2 AND ishlatilgan_vaqt IS NULL", [foydalanuvchiId, maqsad]);
      const token = randomBytes(32).toString("base64url");
      await c.query(
        "INSERT INTO bir_martalik_tokenlar (foydalanuvchi_id, maqsad, token_hash, tugash_vaqti, ip) VALUES ($1, $2, $3, now() + $4 * interval '1 millisecond', $5)",
        [foydalanuvchiId, maqsad, tokenHash(token), MUDDAT_MS[maqsad], ip ?? null]);
      await c.query("COMMIT");
      return token;
    } catch (x) {
      await c.query("ROLLBACK");
      throw x;
    } finally {
      c.release();
    }
  }

  /** Ishlatmasdan: token kimniki (parol siyosatini foydalanuvchi ma'lumoti bilan tekshirish uchun — token keyin ishlat() bilan olinadi) */
  async egasi(token: string, maqsad: Maqsad): Promise<number | undefined> {
    if (!TOKEN.test(token)) return undefined;
    const [q] = await this.#sorov<{ fid: number }>(
      "SELECT foydalanuvchi_id AS fid FROM bir_martalik_tokenlar WHERE token_hash = $1 AND maqsad = $2 AND ishlatilgan_vaqt IS NULL AND tugash_vaqti > now()", [tokenHash(token), maqsad]);
    return q?.fid;
  }

  /** Tokenni ishlatadi (atomik, bir marta) → foydalanuvchi id yoki undefined (yo'q, eskirgan, ishlatilgan, boshqa maqsad) */
  async ishlat(token: string, maqsad: Maqsad): Promise<number | undefined> {
    if (!TOKEN.test(token)) return undefined;
    const [q] = await this.#sorov<{ fid: number }>(
      `UPDATE bir_martalik_tokenlar SET ishlatilgan_vaqt = now()
       WHERE token_hash = $1 AND maqsad = $2 AND ishlatilgan_vaqt IS NULL AND tugash_vaqti > now() RETURNING foydalanuvchi_id AS fid`, [tokenHash(token), maqsad]);
    return q?.fid;
  }
}
