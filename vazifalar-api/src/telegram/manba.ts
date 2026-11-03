// manba.ts — 29-qism B (holat 22): botning VazifaManbai — haqiqiy ma'lumot (#20–#22).
//   ulash tokeni  — Redis (bir martalik: GETDEL, 10 daqiqa); kalitda tokenning sha256'i (Redis dump'ida ham ishlatib bo'lmaydi)
//   chat ↔ hisob  — telegram_ulanishlar (ishchi roli, 205: bot BARCHA chatlarni ko'radi; API roli faqat o'zinikini)
//   vazifalar     — API bilan BIR XIL ombor (omborFabrikasi: PgOmbori [+ Redis kesh] — bot yozsa kesh avlodi ham yangilanadi), RLS ostida;
//                   egalik — ombor ichidagi WHERE egasi_id (callback_data mijozdan keladi — IDOR'ga qarshi, #21)
import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { VazifaOmbori } from "../vazifalar/ombor.ts";
import { egasiSifatida } from "../umumiy/rls.ts";
import { hodisaYoz } from "../navbat/outbox.ts";
import type { BotVazifa, VazifaManbai } from "./bot.ts";

/** Redis'dan kerakli minimum (node-redis 6 klienti mos keladi) */
export type TokenRedis = {
  set(k: string, v: string, o: { EX: number; NX?: true }): Promise<unknown>;
  getDel(k: string): Promise<string | null>;
};

const kalit = (token: string) => `vz:tg:ulash:${createHash("sha256").update(token).digest("hex")}`;
export const ULASH_MUDDAT_S = 600;

/** API: deep link tokeni (32 belgi base64url — /start parametri 64 belgigacha, [A-Za-z0-9_-]) */
export async function ulashTokeni(r: TokenRedis, foydalanuvchiId: number): Promise<string> {
  const t = randomBytes(24).toString("base64url");
  await r.set(kalit(t), String(foydalanuvchiId), { EX: ULASH_MUDDAT_S, NX: true });
  return t;
}

export class PgVazifaManbai implements VazifaManbai {
  readonly #ombor: (fId: number) => VazifaOmbori;
  readonly #malumot: Pool;
  readonly #ishchi: Pool;
  readonly #redis: TokenRedis;
  /**
   * @param ombor API bilan bir xil ombor fabrikasi (yozuvlar)
   * @param malumot vazifalar_api pool'i (RLS) — ro'yxat muddat bilan o'qiladi (API Vazifa turida muddat yo'q)
   * @param ishchi vazifalar_ishchi pool'i — telegram_ulanishlar
   */
  constructor(o: { ombor: (fId: number) => VazifaOmbori; malumot: Pool; ishchi: Pool; redis: TokenRedis }) {
    this.#ombor = o.ombor;
    this.#malumot = o.malumot;
    this.#ishchi = o.ishchi;
    this.#redis = o.redis;
  }

  async tokenniIshlat(token: string): Promise<number | undefined> {
    const f = await this.#redis.getDel(kalit(token));
    return f === null ? undefined : Number(f);
  }

  /** Bir chat — bir hisob: shu chat boshqa hisobga ulangan bo'lsa, o'sha ulanish o'chadi; hisobning eski chati — almashtiriladi */
  async ulash(foydalanuvchiId: number, chatId: number): Promise<void> {
    const c = await this.#ishchi.connect();
    try {
      await c.query("BEGIN");
      await c.query("DELETE FROM telegram_ulanishlar WHERE chat_id = $1 AND foydalanuvchi_id <> $2", [chatId, foydalanuvchiId]);
      await c.query(
        `INSERT INTO telegram_ulanishlar (foydalanuvchi_id, chat_id) VALUES ($1, $2)
         ON CONFLICT (foydalanuvchi_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, faol = true, ulangan_vaqt = now()`,
        [foydalanuvchiId, chatId]);
      await c.query("COMMIT");
    } catch (x) {
      await c.query("ROLLBACK");
      throw x;
    } finally {
      c.release();
    }
  }

  async kim(chatId: number): Promise<number | undefined> {
    const r = await this.#ishchi.query<{ f: string }>(
      "SELECT t.foydalanuvchi_id AS f FROM telegram_ulanishlar t JOIN foydalanuvchilar u ON u.id = t.foydalanuvchi_id WHERE t.chat_id = $1 AND t.faol AND u.bloklangan_vaqt IS NULL",
      [chatId]);
    return r.rows[0] === undefined ? undefined : Number(r.rows[0].f);
  }

  async royxat(foydalanuvchiId: number): Promise<BotVazifa[]> {
    const r = await egasiSifatida(this.#malumot, foydalanuvchiId, (c) => c.query<{ id: string; matn: string; bajarildi: boolean; muddat: Date | null }>(
      "SELECT id, matn, bajarildi, muddat FROM vazifalar WHERE egasi_id = $1 AND ochirilgan_vaqt IS NULL AND NOT bajarildi ORDER BY tartib, id LIMIT 100",
      [foydalanuvchiId]));
    return r.rows.map((q) => ({ id: Number(q.id), matn: q.matn, bajarildi: q.bajarildi, muddat: q.muddat }));
  }

  async bajar(foydalanuvchiId: number, vazifaId: number): Promise<boolean> {
    return (await this.#ombor(foydalanuvchiId).yangila(vazifaId, { bajarildi: true })).tur === "ok";
  }

  /** Muddat — alohida UPDATE + "vazifa.muddat" outbox hodisasi (API Vazifa turida muddat maydoni yo'q; /muddat yo'li bilan bir xil) — yaratish bilan atomik EMAS */
  async yarat(foydalanuvchiId: number, matn: string, muddat: Date | null): Promise<{ id: number }> {
    const v = await this.#ombor(foydalanuvchiId).yarat({ matn });
    if (muddat !== null) {
      await egasiSifatida(this.#malumot, foydalanuvchiId, async (c) => {
        await c.query("UPDATE vazifalar SET muddat = $3 WHERE id = $1 AND egasi_id = $2", [v.id, foydalanuvchiId, muddat]);
        await hodisaYoz(c, "vazifa.muddat", foydalanuvchiId, { id: v.id, muddat: muddat.toISOString(), manba: null }); // holat 50: eslatma relay orqali
      });
    }
    return { id: v.id };
  }
}

/** grammY conversations uchun Redis saqlash (kalit — chat). ioredis talab qiladigan @grammyjs/storage-redis o'rniga — bitta klient (node-redis) */
export type DialogRedis = {
  get(k: string): Promise<string | null>;
  set(k: string, v: string, o: { EX: number }): Promise<unknown>;
  del(k: string): Promise<unknown>;
};
export function dialogSaqlash<T>(r: DialogRedis, ttlS = 24 * 3600) {
  const k = (x: string) => `vz:tg:dialog:${x}`;
  return {
    type: "key" as const,
    adapter: {
      read: async (x: string): Promise<T | undefined> => { const s = await r.get(k(x)); return s === null ? undefined : (JSON.parse(s) as T); },
      write: async (x: string, v: T): Promise<void> => { await r.set(k(x), JSON.stringify(v), { EX: ttlS }); },
      delete: async (x: string): Promise<void> => { await r.del(k(x)); },
    },
  };
}
