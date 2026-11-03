// fabrika.ts — #64 BT-12 (holat 65): test ma'lumoti FACTORY bilan — testda faqat test uchun MUHIM maydonlar yoziladi, qolgani yaroqli sukut.
// Faker (uz_UZ_latin) har test fayli boshida seed bilan — natija deterministik (yiqilgan testni qayta yaratish mumkin).
// Ketma-ket raqam (n) — noyob maydonlar (email, matn) to'qnashmasin (014: faol vazifalar orasida matn noyob).
import { fakerUZ_UZ_latin as faker } from "@faker-js/faker";
import type { Pool } from "pg";

let n = 0;
export function fabrikaniBoshla(seed = 27): void {
  faker.seed(seed);
  n = 0;
}

export type FoydalanuvchiQatori = { id: number; email: string; toliq_ism: string };
export type VazifaQatori = { id: number; egasi_id: number; matn: string; bajarildi: boolean; tartib: number; versiya: number };

export async function foydalanuvchi(pool: Pool, ust: Partial<Pick<FoydalanuvchiQatori, "email" | "toliq_ism">> = {}): Promise<FoydalanuvchiQatori> {
  n++;
  const { rows: [f] } = await pool.query<FoydalanuvchiQatori>(
    "INSERT INTO foydalanuvchilar (email, toliq_ism) VALUES ($1, $2) RETURNING id, email, toliq_ism",
    [ust.email ?? `f${String(n)}@test.example`, ust.toliq_ism ?? faker.person.fullName()]);
  if (f === undefined) throw new Error("foydalanuvchi yaratilmadi");
  return f;
}

/** Egasi berilmasa — o'zi yaratadi (relation bilan factory) */
export async function vazifa(pool: Pool, ust: Partial<Pick<VazifaQatori, "egasi_id" | "matn" | "bajarildi">> = {}): Promise<VazifaQatori> {
  const egasi = ust.egasi_id ?? (await foydalanuvchi(pool)).id;
  n++;
  const bajarildi = ust.bajarildi ?? false;
  const { rows: [v] } = await pool.query<VazifaQatori>(
    `INSERT INTO vazifalar (egasi_id, matn, bajarildi, bajarilgan_vaqt) VALUES ($1, $2, $3, CASE WHEN $3 THEN now() END)
     RETURNING id, egasi_id, matn, bajarildi, tartib, versiya`,
    [egasi, ust.matn ?? `${faker.helpers.arrayElement(["Hisobot", "Non olish", "Kitob o'qish", "Mashq"])} ${String(n)}`, bajarildi]);
  if (v === undefined) throw new Error("vazifa yaratilmadi");
  return v;
}
