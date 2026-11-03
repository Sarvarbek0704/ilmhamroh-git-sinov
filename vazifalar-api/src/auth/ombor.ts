// ombor.ts — auth ma'lumotlari (foydalanuvchilar, auth jadvallari) uchun Postgres ombori (#05). pg to'g'ridan: SAQLASH=postgres ham, prisma ham
// shu omborni ishlatadi (auth jadvallari Prisma modelida ham bor — drift bo'lmasin, lekin so'rovlar bu yerda).
// bigint → number: har so'rovga TURLAR (pool qanday yaratilganidan qat'iy nazar — prisma rejimidagi pool'da tur parseri yo'q).
import pg from "pg";
import type { Pool, QueryResultRow } from "pg";
import { TURLAR } from "../vazifalar/pg-ombor.ts";

export type Foydalanuvchi = { id: number; email: string; toliqIsm: string };
export type HisobQatori = Foydalanuvchi & { parolHash: string | null; emailTasdiqlangan: Date | null };

export type HodisaTuri = "royxat" | "kirish" | "kirish_xato" | "parol_qayta_hash" | "chiqish" | "chiqish_hammasi" | "sessiya_bekor"
  | "royxat_band" | "email_tasdiq" | "parol_tiklash_sorov" | "parol_tiklandi" | "otp_sorov" | "telefon_ulandi"
  | "tashqi_kirish" | "tashqi_boglandi" | "tashqi_rad" | "mfa_yoqildi" | "mfa_ochirildi" | "passkey_qoshildi" | "kirish_mfa_kutilmoqda"
  | "admin_bloklash" | "admin_blokdan_chiqarish" | "bloklangan_kirish" | "api_kalit_yaratildi" | "api_kalit_bekor" | "cheklov_xato" | "bot_tutildi"
  | "hisob_ochirish_rad" | "hisob_ochirildi"; // 31 #12 (hisob_ochirildi — sql/302 funksiyasi yozadi)
export type Hodisa = { tur: HodisaTuri; foydalanuvchiId?: number | undefined; ip?: string | undefined; userAgent?: string | undefined; tafsilot?: Record<string, unknown> };

const USTUNLAR = "id, email, toliq_ism AS \"toliqIsm\", parol_hash AS \"parolHash\", email_tasdiqlangan_vaqt AS \"emailTasdiqlangan\"";

export class EmailBandXatosi extends Error {
  constructor() {
    super("email band");
    this.name = "EmailBandXatosi";
  }
}

export class AuthOmbori {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async #sorov<T extends QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
    return (await this.#pool.query<T>({ text, values, types: TURLAR })).rows;
  }

  /** Registrga befarq (001: lower(email) noyob indeksi shu ifoda bilan — indeks ishlatiladi) */
  async emailBilan(email: string): Promise<HisobQatori | undefined> {
    const [q] = await this.#sorov<HisobQatori>(`SELECT ${USTUNLAR} FROM foydalanuvchilar WHERE lower(email) = lower($1)`, [email]);
    return q;
  }

  /** #13: tasdiqlangan telefon raqami bo'yicha (E.164) */
  async telefonBilan(telefon: string): Promise<HisobQatori | undefined> {
    const [q] = await this.#sorov<HisobQatori>(`SELECT ${USTUNLAR} FROM foydalanuvchilar WHERE telefon = $1`, [telefon]);
    return q;
  }

  /** @returns false — raqam boshqa hisobda (23505 foydalanuvchilar_telefon_key) */
  async telefonniYoz(id: number, telefon: string): Promise<boolean> {
    try {
      await this.#sorov("UPDATE foydalanuvchilar SET telefon = $2 WHERE id = $1", [id, telefon]);
      return true;
    } catch (x) {
      if (x instanceof pg.DatabaseError && x.code === "23505" && x.constraint === "foydalanuvchilar_telefon_key") return false;
      throw x;
    }
  }

  /** #15: tashqi kimlik (provayder + sub) bo'yicha foydalanuvchi; topilsa oxirgi_kirish yangilanadi */
  async tashqiBilan(provayder: string, subyekt: string): Promise<HisobQatori | undefined> {
    const [q] = await this.#sorov<HisobQatori>(
      `UPDATE tashqi_hisoblar t SET oxirgi_kirish = now() FROM foydalanuvchilar f
       WHERE t.provayder = $1 AND t.subyekt = $2 AND f.id = t.foydalanuvchi_id
       RETURNING f.id, f.email, f.toliq_ism AS "toliqIsm", f.parol_hash AS "parolHash", f.email_tasdiqlangan_vaqt AS "emailTasdiqlangan"`, [provayder, subyekt]);
    return q;
  }

  /**
   * Tashqi kimlikni mavjud hisobga bog'lash (bitta tranzaksiya). Hisobning emaili TASDIQLANMAGAN bo'lsa — kimdir oldindan (pre-hijacking) ochgan bo'lishi mumkin:
   * parol o'chiriladi va sessiyalar bekor qilinadi (endi hisob — provayder tasdiqlagan email egasiniki).
   * @returns false — bu foydalanuvchida shu provayderdan boshqa hisob allaqachon bor
   */
  async tashqiBogla(id: number, provayder: string, subyekt: string, email: string | undefined, tasdiqlanmaganniTozala: boolean): Promise<boolean> {
    const c = await this.#pool.connect();
    try {
      await c.query("BEGIN");
      if (tasdiqlanmaganniTozala) {
        await c.query("UPDATE foydalanuvchilar SET parol_hash = NULL WHERE id = $1 AND email_tasdiqlangan_vaqt IS NULL", [id]);
        await c.query("UPDATE sessiyalar SET bekor_vaqti = now() WHERE foydalanuvchi_id = $1 AND bekor_vaqti IS NULL", [id]);
      }
      await c.query("UPDATE foydalanuvchilar SET email_tasdiqlangan_vaqt = coalesce(email_tasdiqlangan_vaqt, now()) WHERE id = $1", [id]);
      await c.query("INSERT INTO tashqi_hisoblar (foydalanuvchi_id, provayder, subyekt, email, oxirgi_kirish) VALUES ($1, $2, $3, $4, now())", [id, provayder, subyekt, email ?? null]);
      await c.query("COMMIT");
      return true;
    } catch (x) {
      await c.query("ROLLBACK");
      if (x instanceof pg.DatabaseError && x.code === "23505" && x.constraint === "tashqi_hisoblar_foydalanuvchi_provayder_key") return false;
      throw x;
    } finally {
      c.release();
    }
  }

  /** #20: bloklangan hisob — hech qaysi yo'l bilan sessiya olmaydi */
  async bloklanganmi(id: number): Promise<boolean> {
    return (await this.#sorov("SELECT 1 FROM foydalanuvchilar WHERE id = $1 AND bloklangan_vaqt IS NOT NULL", [id])).length === 1;
  }

  async idBilan(id: number): Promise<HisobQatori | undefined> {
    const [q] = await this.#sorov<HisobQatori>(`SELECT ${USTUNLAR} FROM foydalanuvchilar WHERE id = $1`, [id]);
    return q;
  }

  /** #15: tashqi provayder tasdiqlagan email bilan yangi hisob (parolsiz, email tasdiqlangan) */
  async yaratTasdiqlangan(email: string, toliqIsm: string): Promise<Foydalanuvchi> {
    const [q] = await this.#sorov<HisobQatori>(
      `INSERT INTO foydalanuvchilar (email, toliq_ism, email_tasdiqlangan_vaqt) VALUES ($1, $2, now()) RETURNING ${USTUNLAR}`, [email, toliqIsm]);
    if (q === undefined) throw new Error("INSERT qator qaytarmadi");
    return { id: q.id, email: q.email, toliqIsm: q.toliqIsm };
  }

  /** @throws EmailBandXatosi — shu email (registrsiz) allaqachon bor (23505 foydalanuvchilar_email_key) */
  async yarat(y: { email: string; toliqIsm: string; parolHash: string | null }): Promise<Foydalanuvchi> {
    try {
      const [q] = await this.#sorov<HisobQatori>(
        `INSERT INTO foydalanuvchilar (email, toliq_ism, parol_hash) VALUES ($1, $2, $3) RETURNING ${USTUNLAR}`, [y.email, y.toliqIsm, y.parolHash]);
      if (q === undefined) throw new Error("INSERT qator qaytarmadi");
      return { id: q.id, email: q.email, toliqIsm: q.toliqIsm };
    } catch (x) {
      if (x instanceof pg.DatabaseError && x.code === "23505" && x.constraint === "foydalanuvchilar_email_key") throw new EmailBandXatosi();
      throw x;
    }
  }

  async emailTasdiqla(id: number): Promise<void> {
    await this.#sorov("UPDATE foydalanuvchilar SET email_tasdiqlangan_vaqt = coalesce(email_tasdiqlangan_vaqt, now()) WHERE id = $1", [id]);
  }

  async parolniYoz(id: number, parolHash: string): Promise<void> {
    await this.#sorov("UPDATE foydalanuvchilar SET parol_hash = $2 WHERE id = $1", [id, parolHash]);
  }

  async hodisa(h: Hodisa): Promise<void> {
    await this.#sorov("INSERT INTO auth_hodisalar (foydalanuvchi_id, tur, ip, user_agent, tafsilot) VALUES ($1, $2, $3, $4, $5)", [
      h.foydalanuvchiId ?? null, h.tur, h.ip ?? null, h.userAgent?.slice(0, 300) ?? null, h.tafsilot ?? {},
    ]);
  }
}
