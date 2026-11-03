// mfa.ts — #19 B-123 (holat 19): ikkinchi omil ma'lumotlari — TOTP (shifrlangan siri), zaxira kodlar (HMAC), passkeys (WebAuthn ochiq kalitlari).
import { createHmac, randomBytes } from "node:crypto";
import pg from "pg";
import type { Pool, QueryResultRow } from "pg";
import { TURLAR } from "../vazifalar/pg-ombor.ts";
import { base32, deshifrla, shifrla, totpTekshir } from "./totp.ts";

export const ZAXIRA_SONI = 10;

export type PasskeyQatori = { id: number; foydalanuvchiId: number; credentialId: string; ochiqKalit: Buffer; hisoblagich: number; transports: string[]; nom: string };

export class MfaOmbori {
  readonly #pool: Pool;
  readonly #totpKalit: Buffer;
  readonly #zaxiraKalit: Buffer;

  constructor(pool: Pool, totpKalit: Buffer, zaxiraKalit: Buffer) {
    this.#pool = pool;
    this.#totpKalit = totpKalit;
    this.#zaxiraKalit = zaxiraKalit;
  }

  async #sorov<T extends QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
    return (await this.#pool.query<T>({ text, values, types: TURLAR })).rows;
  }

  #zaxiraHmac(kod: string): Buffer {
    return createHmac("sha256", this.#zaxiraKalit).update(kod.toUpperCase().replace(/[^A-Z2-7]/g, "")).digest();
  }

  async yoqilganmi(fid: number): Promise<boolean> {
    return (await this.#sorov("SELECT 1 FROM mfa_totp WHERE foydalanuvchi_id = $1 AND yoqilgan_vaqt IS NOT NULL", [fid])).length === 1;
  }

  /** Yangi siri (yoqilmagan holatda saqlanadi). Allaqachon yoqilgan bo'lsa — undefined (avval o'chirish kerak) */
  async sozla(fid: number): Promise<Buffer | undefined> {
    const siri = randomBytes(20);
    const r = await this.#pool.query(
      `INSERT INTO mfa_totp (foydalanuvchi_id, siri_shifr) VALUES ($1, $2)
       ON CONFLICT (foydalanuvchi_id) DO UPDATE SET siri_shifr = EXCLUDED.siri_shifr, oxirgi_qadam = 0, yaratilgan_vaqt = now()
       WHERE mfa_totp.yoqilgan_vaqt IS NULL`, [fid, shifrla(this.#totpKalit, siri, String(fid))]);
    return r.rowCount === 1 ? siri : undefined;
  }

  /**
   * Kod tekshiruvi (sozlash yoki kirish): atomik — `oxirgi_qadam` faqat oshadi (bir kod ikki marta o'tmaydi, ikki parallel so'rovdan bittasi).
   * @param yoqilgan true — faqat yoqilgan TOTP; false — sozlanayotgan
   */
  async totp(fid: number, kod: string, yoqilgan: boolean): Promise<boolean> {
    const [q] = await this.#sorov<{ s: Buffer; o: string }>(
      `SELECT siri_shifr AS s, oxirgi_qadam::text AS o FROM mfa_totp WHERE foydalanuvchi_id = $1 AND (yoqilgan_vaqt IS NOT NULL) = $2`, [fid, yoqilgan]);
    if (q === undefined) return false;
    const qadam = totpTekshir(deshifrla(this.#totpKalit, q.s, String(fid)), kod, BigInt(q.o));
    if (qadam === undefined) return false;
    const r = await this.#pool.query("UPDATE mfa_totp SET oxirgi_qadam = $2 WHERE foydalanuvchi_id = $1 AND oxirgi_qadam < $2", [fid, qadam.toString()]);
    return r.rowCount === 1;
  }

  /** Sozlashni yakunlash: kod to'g'ri bo'lsa — yoqiladi va 10 ta zaxira kod qaytariladi (bir marta ko'rsatiladi) */
  async yoq(fid: number, kod: string): Promise<string[] | undefined> {
    if (!(await this.totp(fid, kod, false))) return undefined;
    const kodlar = Array.from({ length: ZAXIRA_SONI }, () => base32(randomBytes(7)).slice(0, 10).replace(/(.{5})/, "$1-"));
    const c = await this.#pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("UPDATE mfa_totp SET yoqilgan_vaqt = now() WHERE foydalanuvchi_id = $1", [fid]);
      await c.query("DELETE FROM zaxira_kodlar WHERE foydalanuvchi_id = $1", [fid]);
      await c.query("INSERT INTO zaxira_kodlar (foydalanuvchi_id, kod_hmac) SELECT $1, unnest($2::bytea[])", [fid, kodlar.map((k) => this.#zaxiraHmac(k))]);
      await c.query("COMMIT");
    } catch (x) {
      await c.query("ROLLBACK");
      throw x;
    } finally {
      c.release();
    }
    return kodlar;
  }

  /** Zaxira kod — bir marta (atomik UPDATE) */
  async zaxira(fid: number, kod: string): Promise<boolean> {
    const r = await this.#pool.query("UPDATE zaxira_kodlar SET ishlatilgan_vaqt = now() WHERE foydalanuvchi_id = $1 AND kod_hmac = $2 AND ishlatilgan_vaqt IS NULL", [fid, this.#zaxiraHmac(kod)]);
    return r.rowCount === 1;
  }

  async qolganZaxira(fid: number): Promise<number> {
    const [q] = await this.#sorov<{ n: number }>("SELECT count(*)::int AS n FROM zaxira_kodlar WHERE foydalanuvchi_id = $1 AND ishlatilgan_vaqt IS NULL", [fid]);
    return q?.n ?? 0;
  }

  async ochir(fid: number): Promise<void> {
    await this.#pool.query("DELETE FROM mfa_totp WHERE foydalanuvchi_id = $1", [fid]);
    await this.#pool.query("DELETE FROM zaxira_kodlar WHERE foydalanuvchi_id = $1", [fid]);
  }

  // --- passkeys ---
  async passkeylar(fid: number): Promise<PasskeyQatori[]> {
    return this.#sorov<PasskeyQatori>(
      `SELECT id, foydalanuvchi_id AS "foydalanuvchiId", credential_id AS "credentialId", ochiq_kalit AS "ochiqKalit", hisoblagich, transports, nom
       FROM passkeylar WHERE foydalanuvchi_id = $1 ORDER BY id`, [fid]);
  }

  async passkeyTop(credentialId: string): Promise<PasskeyQatori | undefined> {
    const [q] = await this.#sorov<PasskeyQatori>(
      `SELECT id, foydalanuvchi_id AS "foydalanuvchiId", credential_id AS "credentialId", ochiq_kalit AS "ochiqKalit", hisoblagich, transports, nom
       FROM passkeylar WHERE credential_id = $1`, [credentialId]);
    return q;
  }

  /** @returns false — credential boshqa joyda ro'yxatdan o'tgan (23505) */
  async passkeyQosh(fid: number, p: { credentialId: string; ochiqKalit: Uint8Array; hisoblagich: number; transports: string[]; nom: string }): Promise<boolean> {
    try {
      await this.#pool.query("INSERT INTO passkeylar (foydalanuvchi_id, credential_id, ochiq_kalit, hisoblagich, transports, nom) VALUES ($1, $2, $3, $4, $5, $6)",
        [fid, p.credentialId, Buffer.from(p.ochiqKalit), p.hisoblagich, p.transports, p.nom]);
      return true;
    } catch (x) {
      if (x instanceof pg.DatabaseError && x.code === "23505") return false;
      throw x;
    }
  }

  async passkeyIshlatildi(id: number, hisoblagich: number): Promise<void> {
    await this.#pool.query("UPDATE passkeylar SET hisoblagich = $2, oxirgi_ishlatish = now() WHERE id = $1", [id, hisoblagich]);
  }
}
