// sessiya.ts — #07 B-111 (holat 07): server sessiyalari (Postgres) va sessiya cookie'si.
// Token: 32 tasodifiy bayt (256 bit, CSPRNG) → cookie'da base64url; bazada faqat sha256(token). Sessiya tekshiruvi — bitta indeksli so'rov.
// Fixation himoyasi: kirishda HAR DOIM yangi token (eski cookie bo'lsa — u bekor qilinadi); chiqishda bazada bekor + cookie o'chiriladi.
import { createHash, randomBytes } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import type { CookieOptions, Response } from "express";
import { TURLAR } from "../vazifalar/pg-ombor.ts";
import type { Foydalanuvchi } from "./ombor.ts";

export type SessiyaSozlamasi = {
  /** "Meni eslab qol": bo'sh turish chegarasi (ms) — har so'rovda suriladi (sliding); shuncha vaqt so'rov bo'lmasa — sessiya tugaydi */
  idleMs: number;
  /** "Meni eslab qol": mutlaq chegara (ms) — faol bo'lsa ham shundan keyin qayta kirish; cookie Expires shu */
  muddatMs: number;
  /** eslab qolinmagan (#11): idle va mutlaq chegara; cookie Expires'siz — brauzer yopilganda o'chadi */
  qisqaIdleMs: number;
  qisqaMuddatMs: number;
  /** Secure atributi va `__Host-` prefiksi. Chromium http://localhost va http://127.0.0.1 da ham qabul qiladi (t06); LAN IP / http domen — false */
  secure: boolean;
};

export const SUKUT: SessiyaSozlamasi = Object.freeze({ idleMs: 7 * 24 * 3600_000, muddatMs: 30 * 24 * 3600_000, qisqaIdleMs: 12 * 3600_000, qisqaMuddatMs: 7 * 24 * 3600_000, secure: true });

/** `__Host-`: Secure + Path=/ + Domain'siz bo'lishi SHART — brauzer boshqacha cookie'ni rad etadi (t06: `__Host-secsiz`, `__Host-domen`) */
export const cookieNomi = (s: Pick<SessiyaSozlamasi, "secure">): string => (s.secure ? "__Host-sessiya" : "sessiya");

/** oxirgi_faollik har so'rovda yozilmaydi (yozish yuklamasi) — 60 s dan eski bo'lsa yangilanadi */
const FAOLLIK_QADAMI_MS = 60_000;

export const tokenHash = (token: string): Buffer => createHash("sha256").update(token).digest();

export type JoriySessiya = { id: number; foydalanuvchi: Foydalanuvchi; yaratilgan: Date; tugash: Date; eslabQol: boolean; /** #20 RBAC — har so'rovda bazadan */ rol: "foydalanuvchi" | "admin" };

/** Qurilmalar ro'yxati (#11) — token yoki hash YO'Q */
export type SessiyaKorinishi = { id: number; joriy: boolean; eslabQol: boolean; yaratilgan: string; oxirgiFaollik: string; tugash: string; ip: string | null; qurilma: string };

type Qator = { id: number; foydalanuvchiId: number; email: string; toliqIsm: string; yaratilgan: Date; tugash: Date; oxirgi: Date; eslabQol: boolean; rol: "foydalanuvchi" | "admin" };

export class SessiyaOmbori {
  readonly #pool: Pool;
  readonly s: SessiyaSozlamasi;

  constructor(pool: Pool, s: SessiyaSozlamasi = SUKUT) {
    this.#pool = pool;
    this.s = s;
  }

  async #sorov<T extends QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
    return (await this.#pool.query<T>({ text, values, types: TURLAR })).rows;
  }

  /** Yangi sessiya: token faqat qaytariladi (cookie'ga), bazaga hash */
  async yarat(foydalanuvchiId: number, mijoz: { ip?: string | undefined; userAgent?: string | undefined }, eslabQol = true): Promise<{ token: string; tugash: Date; eslabQol: boolean }> {
    const token = randomBytes(32).toString("base64url");
    const [muddat, idle] = eslabQol ? [this.s.muddatMs, this.s.idleMs] : [this.s.qisqaMuddatMs, this.s.qisqaIdleMs];
    const [q] = await this.#sorov<{ tugash: Date }>(
      `INSERT INTO sessiyalar (foydalanuvchi_id, token_hash, tugash_vaqti, ip, user_agent, eslab_qol, idle_muddat)
       VALUES ($1, $2, now() + $3 * interval '1 millisecond', $4, $5, $6, $7 * interval '1 millisecond') RETURNING tugash_vaqti AS tugash`,
      [foydalanuvchiId, tokenHash(token), muddat, mijoz.ip ?? null, mijoz.userAgent?.slice(0, 300) ?? null, eslabQol, idle]);
    if (q === undefined) throw new Error("sessiya yaratilmadi");
    return { token, tugash: q.tugash, eslabQol };
  }

  /** Token → faol sessiya (bekor qilinmagan, mutlaq va idle muddati o'tmagan) yoki undefined */
  async tekshir(token: string): Promise<JoriySessiya | undefined> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined; // 32 bayt base64url — boshqa shakl bazaga ham bormaydi
    const [q] = await this.#sorov<Qator>(
      `SELECT s.id, s.foydalanuvchi_id AS "foydalanuvchiId", f.email, f.toliq_ism AS "toliqIsm",
              s.yaratilgan_vaqt AS yaratilgan, s.tugash_vaqti AS tugash, s.oxirgi_faollik AS oxirgi, s.eslab_qol AS "eslabQol", f.rol
       FROM sessiyalar s JOIN foydalanuvchilar f ON f.id = s.foydalanuvchi_id
       WHERE s.token_hash = $1 AND s.bekor_vaqti IS NULL AND s.tugash_vaqti > now() AND f.bloklangan_vaqt IS NULL
         AND s.oxirgi_faollik > now() - s.idle_muddat`, [tokenHash(token)]);
    if (q === undefined) return undefined;
    if (Date.now() - q.oxirgi.getTime() > FAOLLIK_QADAMI_MS) {
      await this.#sorov("UPDATE sessiyalar SET oxirgi_faollik = now() WHERE id = $1", [q.id]);
    }
    return { id: q.id, foydalanuvchi: { id: q.foydalanuvchiId, email: q.email, toliqIsm: q.toliqIsm }, yaratilgan: q.yaratilgan, tugash: q.tugash, eslabQol: q.eslabQol, rol: q.rol };
  }

  /** Foydalanuvchining faol sessiyalari (qurilmalar) — eng oxirgi faolidan */
  async royxat(foydalanuvchiId: number, joriyId: number): Promise<SessiyaKorinishi[]> {
    const q = await this.#sorov<{ id: number; eslabQol: boolean; yaratilgan: Date; oxirgi: Date; tugash: Date; ip: string | null; ua: string | null }>(
      `SELECT id, eslab_qol AS "eslabQol", yaratilgan_vaqt AS yaratilgan, oxirgi_faollik AS oxirgi, tugash_vaqti AS tugash, host(ip) AS ip, user_agent AS ua
       FROM sessiyalar WHERE foydalanuvchi_id = $1 AND bekor_vaqti IS NULL AND tugash_vaqti > now() AND oxirgi_faollik > now() - idle_muddat
       ORDER BY oxirgi_faollik DESC, id DESC`, [foydalanuvchiId]);
    return q.map((x) => ({ id: x.id, joriy: x.id === joriyId, eslabQol: x.eslabQol, yaratilgan: x.yaratilgan.toISOString(), oxirgiFaollik: x.oxirgi.toISOString(),
      tugash: x.tugash.toISOString(), ip: x.ip, qurilma: qurilma(x.ua) }));
  }

  /** Faqat O'Z sessiyasini bekor qiladi (egasi sharti SQL'da — IDOR) — topilmasa false */
  async egasiBekorQilsin(foydalanuvchiId: number, sessiyaId: number): Promise<boolean> {
    const r = await this.#pool.query("UPDATE sessiyalar SET bekor_vaqti = now() WHERE id = $1 AND foydalanuvchi_id = $2 AND bekor_vaqti IS NULL", [sessiyaId, foydalanuvchiId]);
    return r.rowCount === 1;
  }

  async bekorQil(sessiyaId: number): Promise<void> {
    await this.#sorov("UPDATE sessiyalar SET bekor_vaqti = now() WHERE id = $1 AND bekor_vaqti IS NULL", [sessiyaId]);
  }

  async tokenniBekorQil(token: string): Promise<void> {
    await this.#sorov("UPDATE sessiyalar SET bekor_vaqti = now() WHERE token_hash = $1 AND bekor_vaqti IS NULL", [tokenHash(token)]);
  }

  /** Barcha qurilmalardan chiqish; `qoldir` — joriy sessiya (masalan, parol o'zgartirgan qurilma) */
  async hammasiniBekorQil(foydalanuvchiId: number, qoldir?: number): Promise<number> {
    const r = await this.#pool.query("UPDATE sessiyalar SET bekor_vaqti = now() WHERE foydalanuvchi_id = $1 AND bekor_vaqti IS NULL AND id <> $2", [foydalanuvchiId, qoldir ?? 0]);
    return r.rowCount ?? 0;
  }

  /** eslabQol — doimiy cookie (Expires); aks holda "sessiya cookie'si" (Expires'siz — brauzer yopilganda o'chadi; mutlaq chegara baribir bazada) */
  cookieQoy(res: Response, token: string, tugash: Date, eslabQol = true): void {
    res.cookie(cookieNomi(this.s), token, eslabQol ? { ...this.#atributlar(), expires: tugash } : this.#atributlar());
  }

  cookieOchir(res: Response): void {
    res.clearCookie(cookieNomi(this.s), this.#atributlar());
  }

  #atributlar(): CookieOptions {
    // HttpOnly — JS (XSS) o'qiy olmaydi; SameSite=Lax — boshqa saytdan POST/fetch/iframe'da yuborilmaydi (t06), havola bilan kelganda — yuboriladi
    return { httpOnly: true, secure: this.s.secure, sameSite: "lax", path: "/" };
  }
}

/** Cookie sarlavhasidan bitta cookie (birinchisi). Express 5 da cookie-parser yo'q — bitta nom uchun paket kerak emas */
export function cookieOl(sarlavha: string | undefined, nom: string): string | undefined {
  if (sarlavha === undefined) return undefined;
  for (const qism of sarlavha.split(";")) {
    const i = qism.indexOf("=");
    if (i !== -1 && qism.slice(0, i).trim() === nom) return qism.slice(i + 1).trim();
  }
  return undefined;
}

/** User-Agent'dan qisqa qurilma nomi (to'liq UA ham saqlanadi; bu faqat ro'yxatda ko'rsatish uchun, xavfsizlik qarori emas) */
export function qurilma(ua: string | null): string {
  if (ua === null || ua === "") return "noma'lum";
  const brauzer = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl\//.test(ua) ? "curl" : "boshqa";
  const tizim = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return tizim === "" ? brauzer : `${brauzer}, ${tizim}`;
}
