// kvota.ts — 31-qism #19 (B-210): foydalanuvchi kunlik AI kvotasi (sql/304 `ai_sarf`). Kun — APP_TZ bo'yicha (Toshkent yarim tuni).
// Band qilish — LLM chaqiruvidan OLDIN, bitta atomik SQL bilan (parallel 10 so'rov ham chegaradan oshmaydi — test). Provayder xatosi bo'lsa — qaytariladi
// (foydalanuvchi aybi bo'lmagan xato uchun jazolanmaydi); tokenlar — javobdan keyin qo'shiladi (oldindan noma'lum).
import type { Pool } from "pg";
import { egasiSifatida } from "../umumiy/rls.ts";
import { IlovaXatosi } from "../umumiy/xatolar.ts";

export type KvotaSozlamasi = { kunlikSorov: number; kunlikToken: number; tz: string };

export class KvotaTugadiXatosi extends IlovaXatosi {
  constructor(retryAfterS: number) {
    super(429, "Bugungi AI so'rovlari chegarasi tugadi — ertaga qayta urinib ko'ring", {
      kod: "ai-kvota", sarlavha: "AI kvotasi tugadi", httpSarlavhalar: { "Retry-After": String(retryAfterS) },
    });
  }
}

export class AiKvota {
  constructor(private readonly pool: Pool, private readonly s: KvotaSozlamasi) {}

  /** kvotadan bitta so'rov band qiladi; chegarada — KvotaTugadiXatosi (429, Retry-After — mintaqa yarim tunigacha) */
  async band(egasi: number): Promise<void> {
    const qator = await egasiSifatida(this.pool, egasi, async (c) => (await c.query<{ sorovlar: number; qolgan_s: number }>(
      `INSERT INTO ai_sarf AS s (foydalanuvchi_id, kun, sorovlar) VALUES ($1, (now() AT TIME ZONE $4)::date, 1)
       ON CONFLICT (foydalanuvchi_id, kun) DO UPDATE SET sorovlar = s.sorovlar + 1
         WHERE s.sorovlar < $2 AND s.tokenlar < $3
       RETURNING sorovlar, 0 AS qolgan_s`, [egasi, this.s.kunlikSorov, this.s.kunlikToken, this.s.tz])).rows[0]);
    if (qator !== undefined) return;
    const { rows: [q] } = await this.pool.query<{ s: number }>(
      "SELECT ceil(extract(epoch FROM (((now() AT TIME ZONE $1)::date + 1) - (now() AT TIME ZONE $1))))::int AS s", [this.s.tz]);
    throw new KvotaTugadiXatosi(Math.max(1, q?.s ?? 3600));
  }

  async qaytar(egasi: number): Promise<void> {
    await egasiSifatida(this.pool, egasi, (c) => c.query(
      "UPDATE ai_sarf SET sorovlar = greatest(sorovlar - 1, 0) WHERE foydalanuvchi_id = $1 AND kun = (now() AT TIME ZONE $2)::date", [egasi, this.s.tz]));
  }

  async tokenQosh(egasi: number, tokenlar: number): Promise<void> {
    await egasiSifatida(this.pool, egasi, (c) => c.query(
      "UPDATE ai_sarf SET tokenlar = tokenlar + $3 WHERE foydalanuvchi_id = $1 AND kun = (now() AT TIME ZONE $2)::date", [egasi, this.s.tz, tokenlar]));
  }

  async holat(egasi: number): Promise<{ sorovlar: number; tokenlar: number; chegara: { sorovlar: number; tokenlar: number } }> {
    const q = await egasiSifatida(this.pool, egasi, async (c) => (await c.query<{ sorovlar: number; tokenlar: number }>(
      "SELECT sorovlar, tokenlar FROM ai_sarf WHERE foydalanuvchi_id = $1 AND kun = (now() AT TIME ZONE $2)::date", [egasi, this.s.tz])).rows[0]);
    return { sorovlar: q?.sorovlar ?? 0, tokenlar: q?.tokenlar ?? 0, chegara: { sorovlar: this.s.kunlikSorov, tokenlar: this.s.kunlikToken } };
  }
}
