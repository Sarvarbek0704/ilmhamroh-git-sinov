// otp.ts — #13 B-117 (holat 13): SMS kod (OTP) bilan kirish va telefonni ulash. SMS provayder — interfeys; haqiqiy Eskiz / PlayMobile — SINALMAGAN (mock).
// Qoidalar: 6 raqam (crypto.randomInt — Math.random EMAS), 5 daqiqa, 5 urinish, bir marta; bazada HMAC-SHA256(OTP_SIRI) — sizib chiqqan bazadan kodni
// 10^6 urinishda topib bo'lmaydi (t13); yuborish chastotasi: raqamga 60 s oraliq, soatiga 5, kuniga 10; faqat ruxsat etilgan mamlakat kodlari (SMS pumping — #30).
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { TURLAR } from "../vazifalar/pg-ombor.ts";
import type { Log } from "../umumiy/log.ts";

export type OtpMaqsadi = "kirish" | "telefon_ulash";

/**
 * 30 B BACKLOG 2 (NIST SP 800-63B §5.2.2): kod bo'yicha 5 urinish yetmaydi — hujumchi kuniga 10 ta yangi kod so'rab 50 urinish qiladi (oyiga 1 500 —
 * 10^6 dan ~0.15 %). Endi HISOB bo'yicha ham: oxirgi muvaffaqiyatli OTP'dan beri ketma-ket xato urinishlar ≤ hisobXato (100); oshsa — OTP bilan kirish
 * yopiladi (parol / passkey / parol tiklash qoladi), keyingi muvaffaqiyatli OTP (masalan telefon_ulash) yoki admin hisoblagichni nollaydi.
 */
export const OTP = Object.freeze({ uzunlik: 6, muddatMs: 5 * 60_000, maksUrinish: 5, oraliqMs: 60_000, soatiga: 5, kuniga: 10, hisobXato: 100 });

/** SMS yuborish interfeysi (Eskiz, PlayMobile … — 29-qism / hujjat) */
export interface SmsYuboruvchi {
  yubor(telefon: string, matn: string): Promise<void>;
}

export class XotiraSms implements SmsYuboruvchi {
  readonly yuborilgan: { telefon: string; matn: string }[] = [];
  yubor(telefon: string, matn: string): Promise<void> {
    this.yuborilgan.push({ telefon, matn });
    return Promise.resolve();
  }
  oxirgiKod(telefon?: string): string | undefined {
    const x = this.yuborilgan.filter((y) => telefon === undefined || y.telefon === telefon).at(-1);
    return x === undefined ? undefined : /\b(\d{6})\b/.exec(x.matn)?.[1];
  }
}

/** Dev: SMS log'ga (kod — sir; production'da config buni rad etadi — 29-qismgacha production yopiq) */
export class LogSms implements SmsYuboruvchi {
  readonly #log: () => Pick<Log, "info">;
  constructor(log: () => Pick<Log, "info">) {
    this.#log = log;
  }
  yubor(telefon: string, matn: string): Promise<void> {
    this.#log().info({ sms: { telefon, matn } }, "sms (dev): yuborilmadi, log'ga yozildi");
    return Promise.resolve();
  }
}

/** Kod: CSPRNG, oldidagi nollar bilan ("004217") */
export const yangiKod = (): string => String(randomInt(0, 10 ** OTP.uzunlik)).padStart(OTP.uzunlik, "0");

export type YuborishNatijasi = { tur: "yuborildi"; kod: string } | { tur: "cheklov"; sabab: "oraliq" | "soatiga" | "kuniga" };
export type TekshiruvNatijasi = { tur: "ok"; foydalanuvchiId: number } | { tur: "xato"; sabab?: "hisob-chegarasi" };

export class OtpOmbori {
  readonly #pool: Pool;
  readonly #siri: Buffer;

  /** @param siri OTP_SIRI (≥ 32 bayt) — bazada emas, config'da */
  constructor(pool: Pool, siri: Buffer) {
    if (siri.length < 32) throw new Error("OTP siri kamida 32 bayt bo'lsin");
    this.#pool = pool;
    this.#siri = siri;
  }

  /** maqsad va telefon ham HMAC ichida — bir maqsadning kodi boshqasiga yaramaydi */
  #hmac(maqsad: OtpMaqsadi, telefon: string, kod: string): Buffer {
    return createHmac("sha256", this.#siri).update(`${maqsad}:${telefon}:${kod}`).digest();
  }

  /** Yangi kod (chastota cheklovlari bilan). Eski faol kodlar bekor. Bitta tranzaksiya, telefon bo'yicha advisory lock — parallel so'rovlar ikki SMS yubormasin */
  async yarat(foydalanuvchiId: number, maqsad: OtpMaqsadi, telefon: string, ip?: string): Promise<YuborishNatijasi> {
    const c = await this.#pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 28))", [telefon]);
      const { rows: [q] } = await c.query<{ oraliq: boolean; soat: number; kun: number }>(
        `SELECT coalesce(max(yaratilgan_vaqt) > now() - $2 * interval '1 millisecond', false) AS oraliq,
                count(*) FILTER (WHERE yaratilgan_vaqt > now() - interval '1 hour')::int AS soat,
                count(*) FILTER (WHERE yaratilgan_vaqt > now() - interval '1 day')::int AS kun
         FROM otp_kodlar WHERE telefon = $1 AND yaratilgan_vaqt > now() - interval '1 day'`, [telefon, OTP.oraliqMs]);
      const sabab = q?.oraliq === true ? "oraliq" : (q?.soat ?? 0) >= OTP.soatiga ? "soatiga" : (q?.kun ?? 0) >= OTP.kuniga ? "kuniga" : undefined;
      if (sabab !== undefined) {
        await c.query("ROLLBACK");
        return { tur: "cheklov", sabab };
      }
      // 30 B: eski kodlar "bekor" — muddati tugatiladi (avval ishlatilgan_vaqt qo'yilardi: bu hisob xatolari hisoblagichini (BACKLOG 2) nollab yuborardi —
      // hujumchi har yangi SMS bilan hisobni "tozalardi". ishlatilgan_vaqt — endi faqat MUVAFFAQIYATLI tekshiruv)
      await c.query("UPDATE otp_kodlar SET tugash_vaqti = now() WHERE telefon = $1 AND ishlatilgan_vaqt IS NULL AND tugash_vaqti > now()", [telefon]);
      const kod = yangiKod();
      await c.query(
        "INSERT INTO otp_kodlar (foydalanuvchi_id, maqsad, telefon, kod_hmac, tugash_vaqti, ip) VALUES ($1, $2, $3, $4, now() + $5 * interval '1 millisecond', $6)",
        [foydalanuvchiId, maqsad, telefon, this.#hmac(maqsad, telefon, kod), OTP.muddatMs, ip ?? null]);
      await c.query("COMMIT");
      return { tur: "yuborildi", kod };
    } catch (x) {
      await c.query("ROLLBACK");
      throw x;
    } finally {
      c.release();
    }
  }

  /**
   * Kodni tekshiradi: oxirgi faol kod (raqam + maqsad). Har urinish hisoblanadi (atomik UPDATE … urinishlar + 1 RETURNING) — 5 dan keyin kod o'ladi,
   * hatto to'g'ri kod ham. To'g'ri bo'lsa — ishlatilgan. Solishtirish — timingSafeEqual.
   */
  async tekshir(maqsad: OtpMaqsadi, telefon: string, kod: string, foydalanuvchiId?: number): Promise<TekshiruvNatijasi> {
    // 30 B: hisob bo'yicha ketma-ket xatolar — oxirgi ISHLATILGAN koddan keyin yaratilgan, ishlatilmagan kodlarning urinishlari yig'indisi (yangi
    // jadval/ustun kerak emas). Hisob qatori FOR UPDATE bilan qulflanadi — parallel urinishlar chegarani oshirib o'tolmaydi (aynan ≤ hisobXato)
    const c = await this.#pool.connect();
    let q: { id: number; fid: number; hmac: Buffer; urinishlar: number } | undefined;
    try {
      await c.query("BEGIN");
      const { rows: [k] } = await c.query<{ id: number; fid: number }>({
        text: `SELECT id, foydalanuvchi_id AS fid FROM otp_kodlar WHERE telefon = $1 AND maqsad = $2 AND ishlatilgan_vaqt IS NULL AND tugash_vaqti > now()
                 AND ($3::bigint IS NULL OR foydalanuvchi_id = $3) ORDER BY yaratilgan_vaqt DESC LIMIT 1`,
        values: [telefon, maqsad, foydalanuvchiId ?? null], types: TURLAR });
      if (k !== undefined) {
        await c.query("SELECT 1 FROM foydalanuvchilar WHERE id = $1 FOR UPDATE", [k.fid]);
        const { rows: [x] } = await c.query<{ n: number }>(
          `SELECT coalesce(sum(urinishlar), 0)::int AS n FROM otp_kodlar
           WHERE foydalanuvchi_id = $1 AND ishlatilgan_vaqt IS NULL
             AND yaratilgan_vaqt > coalesce((SELECT max(ishlatilgan_vaqt) FROM otp_kodlar WHERE foydalanuvchi_id = $1), '-infinity')`, [k.fid]);
        if ((x?.n ?? 0) >= OTP.hisobXato) {
          await c.query("ROLLBACK");
          return { tur: "xato", sabab: "hisob-chegarasi" };
        }
        ({ rows: [q] } = await c.query<{ id: number; fid: number; hmac: Buffer; urinishlar: number }>({
          text: `UPDATE otp_kodlar SET urinishlar = urinishlar + 1 WHERE id = $1 AND urinishlar < $2
                 RETURNING id, foydalanuvchi_id AS fid, kod_hmac AS hmac, urinishlar`,
          values: [k.id, OTP.maksUrinish], types: TURLAR }));
      }
      await c.query("COMMIT");
    } catch (x) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw x;
    } finally {
      c.release();
    }
    if (q === undefined || !/^\d{6}$/.test(kod)) return { tur: "xato" };
    if (!timingSafeEqual(q.hmac, this.#hmac(maqsad, telefon, kod))) return { tur: "xato" };
    const r = await this.#pool.query("UPDATE otp_kodlar SET ishlatilgan_vaqt = now() WHERE id = $1 AND ishlatilgan_vaqt IS NULL", [q.id]);
    return r.rowCount === 1 ? { tur: "ok", foydalanuvchiId: q.fid } : { tur: "xato" };
  }
}

/** E.164 ga keltirish: "+998 90 000-00-00", "998900000000", "90 000 00 00" (9 raqam — O'zbekiston) → "+998900000000"; yaroqsiz — undefined */
export function telefonNormallash(x: string): string | undefined {
  const r = x.replace(/[\s\-()]/g, "");
  const t = /^\d{9}$/.test(r) ? `+998${r}` : /^998\d{9}$/.test(r) ? `+${r}` : r;
  return /^\+[1-9]\d{7,14}$/.test(t) ? t : undefined;
}
