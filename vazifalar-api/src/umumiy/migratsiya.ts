// migratsiya.ts — #40 DB-101 (holat 40): server ishga tushganda baza migratsiyalari koddagi bilan mosmi. Migratsiyani SERVER O'ZI
// QO'LLAMAYDI — bu deploy jarayonining alohida qadami (`npm run db:migrate` = prisma migrate deploy: advisory lock bilan, bir marta).
// Server faqat tekshiradi: kod kutayotgan migratsiya bazada yo'q bo'lsa (deploy qadami unutilgan/yiqilgan) — production'da ishga tushmaydi.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";

export type MigratsiyaHolati =
  | { tur: "mos"; soni: number }
  | { tur: "kutilmoqda"; nomlar: string[] }
  | { tur: "yiqilgan"; nomlar: string[] }
  | { tur: "nomalum"; sabab: string };

/** Koddagi migratsiyalar (prisma/migrations/<nom>/migration.sql papkalari) */
export async function koddagiMigratsiyalar(papka = join(import.meta.dirname, "..", "..", "prisma", "migrations")): Promise<string[]> {
  const ichida = await readdir(papka, { withFileTypes: true });
  return ichida.filter((x) => x.isDirectory()).map((x) => x.name).sort();
}

export async function migratsiyaHolati(pool: Pool, koddagi: readonly string[]): Promise<MigratsiyaHolati> {
  const { rows: [jadval] } = await pool.query<{ bor: boolean }>("SELECT to_regclass('_prisma_migrations') IS NOT NULL AS bor");
  // Baza migratsiya vositasisiz qurilgan (qur.sh, testlar) — tekshirib bo'lmaydi
  if (jadval?.bor !== true) return { tur: "nomalum", sabab: "_prisma_migrations jadvali yo'q (baza prisma migrate bilan boshqarilmaydi)" };
  const { rows } = await pool.query<{ migration_name: string; tugagan: boolean; bekor: boolean }>(
    "SELECT migration_name, finished_at IS NOT NULL AS tugagan, rolled_back_at IS NOT NULL AS bekor FROM _prisma_migrations");
  const yiqilgan = rows.filter((r) => !r.tugagan && !r.bekor).map((r) => r.migration_name);
  if (yiqilgan.length > 0) return { tur: "yiqilgan", nomlar: yiqilgan };
  const bazada = new Set(rows.filter((r) => r.tugagan).map((r) => r.migration_name));
  const kutilmoqda = koddagi.filter((m) => !bazada.has(m));
  return kutilmoqda.length > 0 ? { tur: "kutilmoqda", nomlar: kutilmoqda } : { tur: "mos", soni: koddagi.length };
}
