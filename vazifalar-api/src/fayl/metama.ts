// metama.ts — fayl metama'lumoti (sql/201-fayllar.sql): yozish, dedup, biriktirish, yetimlarni tozalash (B-140).
// Hamma so'rov egasi bilan (RLS ostida ham, superuser bilan ham to'g'ri ishlaydi). Baytlar — FaylOmbori (S3).
import type { Pool, PoolClient } from "pg";
import type { FaylOmbori } from "./s3.ts";

export type Fayl = { id: number; egasiId: number; kalit: string; mime: string; hajm: number; sha256: string | null; holat: "kutilmoqda" | "tayyor" };
export type Ilova = { faylId: number; aslNom: string; mime: string; hajm: number; kalit: string; qoshilgan: Date };

type FaylQator = { id: string; egasi_id: string; kalit: string; mime: string; hajm: string; sha256: Buffer | null; holat: "kutilmoqda" | "tayyor" };
const qatordan = (q: FaylQator): Fayl => ({
  id: Number(q.id), egasiId: Number(q.egasi_id), kalit: q.kalit, mime: q.mime, hajm: Number(q.hajm),
  sha256: q.sha256 ? q.sha256.toString("hex") : null, holat: q.holat,
});

export const MAKS_ILOVA = 10;

export class IlovaXato extends Error {
  readonly kod: "topilmadi" | "limit" | "tayyor-emas";
  constructor(kod: "topilmadi" | "limit" | "tayyor-emas", xabar: string) {
    super(xabar);
    this.name = "IlovaXato";
    this.kod = kod;
  }
}

/**
 * Server tekshirgan (oqimli yuklash) faylni yozadi. Egasida shu sha256 li fayl bo'lsa — YANGI yozuv qilinmaydi, eskisi qaytadi
 * (`dublikat: true`) va chaqiruvchi yangi S3 obyektini o'chiradi. Parallel ikki bir xil yuklash — UNIQUE + ON CONFLICT hal qiladi.
 */
export async function tayyorFaylYoz(db: Pool | PoolClient, f: { egasiId: number; kalit: string; mime: string; hajm: number; sha256: string }): Promise<{ fayl: Fayl; dublikat: boolean }> {
  const r = await db.query<FaylQator>(
    `INSERT INTO fayllar (egasi_id, kalit, mime, hajm, sha256, holat, tasdiqlangan_vaqt)
     VALUES ($1, $2, $3, $4, decode($5, 'hex'), 'tayyor', now())
     ON CONFLICT (egasi_id, sha256) DO NOTHING
     RETURNING id, egasi_id, kalit, mime, hajm, sha256, holat`,
    [f.egasiId, f.kalit, f.mime, f.hajm, f.sha256],
  );
  const yangi = r.rows[0];
  if (yangi) return { fayl: qatordan(yangi), dublikat: false };
  const eski = await db.query<FaylQator>(
    `SELECT id, egasi_id, kalit, mime, hajm, sha256, holat FROM fayllar WHERE egasi_id = $1 AND sha256 = decode($2, 'hex')`,
    [f.egasiId, f.sha256],
  );
  const q = eski.rows[0];
  if (!q) throw new Error("ON CONFLICT bo'ldi, lekin qator topilmadi (parallel o'chirildi)");
  return { fayl: qatordan(q), dublikat: true };
}

/**
 * Faylni vazifaga biriktiradi: egalik, holat, limit. Ikkinchi marta biriktirish — o'zgarishsiz (idempotent).
 * B bosqichi (vazifalar-api): `c` — chaqiruvchining tranzaksiyasi (egasiSifatida — RLS uchun set_config shu tranzaksiyada); A modulida o'zi BEGIN qilardi.
 */
export async function biriktir(c: PoolClient, egasiId: number, vazifaId: number, faylId: number, aslNom: string): Promise<void> {
  // Vazifa qatorini qulflaymiz — parallel biriktirishlar limitni birga oshirib yubormasin
  const v = await c.query("SELECT 1 FROM vazifalar WHERE id = $1 AND egasi_id = $2 AND ochirilgan_vaqt IS NULL FOR UPDATE", [vazifaId, egasiId]);
  if (v.rowCount === 0) throw new IlovaXato("topilmadi", "Vazifa topilmadi");
  const f = await c.query<{ holat: string }>("SELECT holat FROM fayllar WHERE id = $1 AND egasi_id = $2", [faylId, egasiId]);
  const fq = f.rows[0];
  if (!fq) throw new IlovaXato("topilmadi", "Fayl topilmadi");
  if (fq.holat !== "tayyor") throw new IlovaXato("tayyor-emas", "Fayl hali tasdiqlanmagan");
  const n = await c.query<{ soni: number }>("SELECT count(*)::int AS soni FROM vazifa_ilovalari WHERE vazifa_id = $1", [vazifaId]);
  if ((n.rows[0]?.soni ?? 0) >= MAKS_ILOVA) throw new IlovaXato("limit", `Bitta vazifaga ko'pi bilan ${String(MAKS_ILOVA)} ta fayl`);
  await c.query("INSERT INTO vazifa_ilovalari (vazifa_id, fayl_id, asl_nom) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [vazifaId, faylId, aslNom]);
}

export async function ilovalar(db: Pool | PoolClient, egasiId: number, vazifaId: number): Promise<Ilova[]> {
  const r = await db.query<{ fayl_id: string; asl_nom: string; mime: string; hajm: string; kalit: string; qoshilgan_vaqt: Date }>(
    `SELECT i.fayl_id, i.asl_nom, f.mime, f.hajm, f.kalit, i.qoshilgan_vaqt
       FROM vazifa_ilovalari i JOIN fayllar f ON f.id = i.fayl_id JOIN vazifalar v ON v.id = i.vazifa_id
      WHERE i.vazifa_id = $1 AND v.egasi_id = $2
      ORDER BY i.qoshilgan_vaqt, i.fayl_id`,
    [vazifaId, egasiId],
  );
  return r.rows.map((q) => ({ faylId: Number(q.fayl_id), aslNom: q.asl_nom, mime: q.mime, hajm: Number(q.hajm), kalit: q.kalit, qoshilgan: q.qoshilgan_vaqt }));
}

export async function ilovaniOl(db: Pool | PoolClient, egasiId: number, vazifaId: number, faylId: number): Promise<boolean> {
  const r = await db.query(
    "DELETE FROM vazifa_ilovalari i USING vazifalar v WHERE i.vazifa_id = $1 AND i.fayl_id = $2 AND v.id = i.vazifa_id AND v.egasi_id = $3",
    [vazifaId, faylId, egasiId],
  );
  return r.rowCount === 1;
}

/**
 * Yetim fayllarni tozalaydi: biriktirilmagan va `yoshSoniya` dan eski. Tartib: AVVAL S3 (idempotent), KEYIN baza —
 * o'rtada uzilsa qator qoladi va keyingi ishga tushishda qayta o'chiriladi; teskari tartibda S3 da egasiz bayt qolib ketardi.
 * Qatorni `FOR UPDATE SKIP LOCKED` bilan oladi — ikki nusxa (ikki server) bir vaqtda ishlasa ham bir faylni ikki marta olmaydi.
 */
export async function yetimlarniTozala(db: Pool, ombor: FaylOmbori, yoshSoniya = 24 * 3600, partiya = 100): Promise<{ ochirildi: number }> {
  let jami = 0;
  for (;;) {
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      const r = await c.query<{ id: string; kalit: string }>(
        `SELECT f.id, f.kalit FROM fayllar f
          WHERE f.yaratilgan_vaqt < now() - make_interval(secs => $1)
            AND NOT EXISTS (SELECT 1 FROM vazifa_ilovalari i WHERE i.fayl_id = f.id)
          ORDER BY f.yaratilgan_vaqt
          LIMIT $2
          FOR UPDATE OF f SKIP LOCKED`,
        [yoshSoniya, partiya],
      );
      for (const q of r.rows) await ombor.ochir(q.kalit);
      if (r.rows.length > 0) await c.query("DELETE FROM fayllar WHERE id = ANY($1::bigint[])", [r.rows.map((q) => q.id)]);
      await c.query("COMMIT");
      jami += r.rows.length;
      if (r.rows.length < partiya) return { ochirildi: jami };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}
