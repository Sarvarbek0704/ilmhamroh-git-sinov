// rls.ts — 29-qism B (holat 06): pool'dagi bitta ulanishda tranzaksiya + joriy foydalanuvchi (RLS, sql/105 va 119). PgOmbori.#tranzaksiyada bilan bir xil naqsh —
// fayllar, bildirishnomalar va boshqa 29-qism jadvallari ham vazifalar_api roli bilan RLS ostida o'qiladi/yoziladi.
import type { Pool, PoolClient } from "pg";

export async function egasiSifatida<T>(pool: Pool, egasiId: number, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('ilova.foydalanuvchi_id', $1, true)", [String(egasiId)]);
    const natija = await fn(c);
    await c.query("COMMIT");
    return natija;
  } catch (x) {
    await c.query("ROLLBACK");
    throw x;
  } finally {
    c.release();
  }
}
