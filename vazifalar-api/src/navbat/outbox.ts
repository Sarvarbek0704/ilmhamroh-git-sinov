// outbox.ts — transactional outbox (sql/204): `hodisaYoz` — chaqiruvchining tranzaksiyasi ichida; `relay` — tarqatilmaganlarni partiyalab olib, tarqatuvchiga beradi (B-184).
// Bir nechta relay nusxasi parallel ishlashi mumkin (SKIP LOCKED). Tartib: bitta relay ichida id bo'yicha; ko'p nusxada global tartib kafolatlanmaydi.
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type OutboxHodisa = { id: number; hodisaId: string; tur: string; foydalanuvchiId: number; malumot: unknown; yaratilgan: Date };

/**
 * MUHIM: `c` — vazifani yozayotgan o'sha tranzaksiya mijozi. COMMIT bo'lmasa hodisa ham yo'q, ROLLBACK bo'lsa — ikkalasi ham yo'q.
 * 29-qism B (holat 50): hodisa_id ilovada yaratiladi va RETURNING YO'Q — ilova roliga outbox'dan o'qish huquqi berilmagan (204: faqat INSERT);
 * RETURNING SELECT huquqini talab qiladi (A dagi kod superuser bilan sinalgan edi — haqiqiy `vazifalar_api` roli bilan jonli tekshiruvda 42501 berdi).
 */
export async function hodisaYoz(c: PoolClient, tur: string, foydalanuvchiId: number, malumot: unknown): Promise<string> {
  const id = randomUUID();
  await c.query("INSERT INTO outbox (hodisa_id, tur, foydalanuvchi_id, malumot) VALUES ($1, $2, $3, $4)", [id, tur, foydalanuvchiId, malumot]);
  return id;
}

/**
 * Bitta partiya: qatorlar qulflanadi (SKIP LOCKED), tarqatuvchi muvaffaqiyatli qaytsa — belgilanadi, xato bo'lsa `urinishlar++` va qator qoladi.
 * Tarqatuvchi ichida xato — butun partiya emas, faqat o'sha hodisa qayta.
 */
export async function relay(pool: Pool, tarqat: (h: OutboxHodisa) => Promise<void>, partiya = 100, xatoda: (h: OutboxHodisa, e: unknown) => void = () => undefined): Promise<{ tarqatildi: number; xato: number }> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query<{ id: string; hodisa_id: string; tur: string; foydalanuvchi_id: string; malumot: unknown; yaratilgan_vaqt: Date }>(
      "SELECT id, hodisa_id, tur, foydalanuvchi_id, malumot, yaratilgan_vaqt FROM outbox WHERE tarqatilgan_vaqt IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED",
      [partiya],
    );
    const ok: string[] = [];
    const yomon: string[] = [];
    for (const q of r.rows) {
      const h = { id: Number(q.id), hodisaId: q.hodisa_id, tur: q.tur, foydalanuvchiId: Number(q.foydalanuvchi_id), malumot: q.malumot, yaratilgan: q.yaratilgan_vaqt };
      try {
        await tarqat(h);
        ok.push(q.id);
      } catch (e) {
        // 29-qism B (holat 50): xato yutilmaydi — chaqiruvchi log'ga yozadi; qator qoladi va keyingi aylanishda qayta olinadi
        xatoda(h, e);
        yomon.push(q.id);
      }
    }
    if (ok.length) await c.query("UPDATE outbox SET tarqatilgan_vaqt = now(), urinishlar = urinishlar + 1 WHERE id = ANY($1::bigint[])", [ok]);
    if (yomon.length) await c.query("UPDATE outbox SET urinishlar = urinishlar + 1 WHERE id = ANY($1::bigint[])", [yomon]);
    await c.query("COMMIT");
    return { tarqatildi: ok.length, xato: yomon.length };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** Eski tarqatilganlarni tozalash (jadval cheksiz o'smasin) — rejali ish (#48). */
export async function outboxTozala(pool: Pool, saqlashKun = 7): Promise<number> {
  const r = await pool.query("DELETE FROM outbox WHERE tarqatilgan_vaqt < now() - make_interval(days => $1)", [saqlashKun]);
  return r.rowCount ?? 0;
}
