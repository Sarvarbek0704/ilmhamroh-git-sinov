// markaz.ts — bildirishnoma tizimi (B-152, AR-44): bitta `bildir()` → bazada in-app yozuv (dedup) + har kanal uchun `yetkazishlar` qatori → navbat.
// Kanal tanlash: foydalanuvchi afzalligi (sozlamalar.bildirishnoma) + kanal manzili bormi (telegram ulangan, push obuna) + sukut (SMS — faqat aniq yoqilsa).
// Yetkazish (worker): rate limit (kanal bo'yicha soatlik), yuboruvchi natijasi → holat; eskirgan manzil (410, Telegram 403) → manzil o'chiriladi/faolsizlanadi.
// `yetkazishlar.holat = 'navbatda'` qatori o'zi "outbox": navbatga qo'yish yo'qolsa (jarayon COMMIT dan keyin o'lsa) `qolibKetganlar()` qayta topadi (#50).
import type { Pool, PoolClient } from "pg";

export type Kanal = "email" | "telegram" | "push" | "sms";
export const KANALLAR: readonly Kanal[] = ["email", "telegram", "push", "sms"];
export type YetkazishIshi = { bildirishnomaId: number; kanal: Kanal };
export interface Navbat { qosh(ishlar: YetkazishIshi[]): Promise<void> }

export type Qabul = { foydalanuvchiId: number; email: string; telefon: string | null; chatId: string | null; pushlar: { id: number; endpoint: string; p256dh: string; auth: string }[] };
export type Xabar = { id: number; tur: string; sarlavha: string; matn: string; havola: string | null };
export type YuborishNatija = { holat: "yuborildi" } | { holat: "eskirgan"; pushId?: number } | { holat: "qayta"; sabab: string } | { holat: "xato"; sabab: string };
export type Yuboruvchi = (q: Qabul, x: Xabar) => Promise<YuborishNatija>;

/** Kanal bo'yicha soatlik chegara (bitta foydalanuvchiga). SMS qimmat — eng past. */
export const SOATLIK_LIMIT: Record<Kanal, number> = { email: 10, telegram: 30, push: 30, sms: 3 };
const SUKUT: Record<Kanal, boolean> = { email: true, telegram: true, push: true, sms: false };

export class BildirishnomaMarkazi {
  readonly #db: Pool;
  readonly #navbat: Navbat;
  readonly #limit: Record<Kanal, number>;
  constructor(db: Pool, navbat: Navbat, limit: Partial<Record<Kanal, number>> = {}) {
    this.#db = db;
    this.#navbat = navbat;
    this.#limit = { ...SOATLIK_LIMIT, ...limit };
  }

  /** Bildirishnoma yaratadi. `dedupKalit` bilan takror chaqiruv — yangi yozuv ham, yangi yuborish ham yo'q (`yangi: false`). */
  async bildir(foydalanuvchiId: number, x: { tur: string; sarlavha: string; matn: string; havola?: string; dedupKalit?: string; kanallar?: Kanal[] }): Promise<{ id: number; yangi: boolean; kanallar: Kanal[] }> {
    const c = await this.#db.connect();
    let natija: { id: number; yangi: boolean; kanallar: Kanal[] };
    try {
      await c.query("BEGIN");
      const r = await c.query<{ id: string }>(
        `INSERT INTO bildirishnomalar (foydalanuvchi_id, tur, sarlavha, matn, havola, dedup_kalit) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (foydalanuvchi_id, dedup_kalit) DO NOTHING RETURNING id`,
        [foydalanuvchiId, x.tur, x.sarlavha, x.matn, x.havola ?? null, x.dedupKalit ?? null],
      );
      const yangiId = r.rows[0]?.id;
      if (yangiId === undefined) {
        const eski = await c.query<{ id: string }>("SELECT id FROM bildirishnomalar WHERE foydalanuvchi_id = $1 AND dedup_kalit = $2", [foydalanuvchiId, x.dedupKalit]);
        await c.query("COMMIT");
        return { id: Number(eski.rows[0]?.id), yangi: false, kanallar: [] };
      }
      const kanallar = await this.#kanallarniTanla(c, foydalanuvchiId, x.kanallar ?? KANALLAR);
      if (kanallar.length > 0) {
        await c.query("INSERT INTO yetkazishlar (bildirishnoma_id, kanal) SELECT $1, unnest($2::text[])", [yangiId, kanallar]);
      }
      await c.query("COMMIT");
      natija = { id: Number(yangiId), yangi: true, kanallar };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    // COMMIT'dan KEYIN: navbat bazadagi qatorni ko'rishi kafolatlangan. Bu yerda jarayon o'lsa — qolibKetganlar() topadi.
    if (natija.kanallar.length > 0) await this.#navbat.qosh(natija.kanallar.map((kanal) => ({ bildirishnomaId: natija.id, kanal })));
    return natija;
  }

  async #kanallarniTanla(c: PoolClient, fId: number, soralgan: readonly Kanal[]): Promise<Kanal[]> {
    const r = await c.query<{ sozlama: Record<string, unknown> | null; telegram: boolean; push: boolean; sms: boolean }>(
      `SELECT f.sozlamalar->'bildirishnoma' AS sozlama,
              EXISTS (SELECT 1 FROM telegram_ulanishlar t WHERE t.foydalanuvchi_id = f.id AND t.faol) AS telegram,
              EXISTS (SELECT 1 FROM push_obunalar p WHERE p.foydalanuvchi_id = f.id) AS push,
              f.telefon IS NOT NULL AS sms
         FROM foydalanuvchilar f WHERE f.id = $1`,
      [fId],
    );
    const q = r.rows[0];
    if (!q) return [];
    const yoqilgan = (k: Kanal) => { const v = q.sozlama?.[k]; return typeof v === "boolean" ? v : SUKUT[k]; };
    // 29-qism B (holat 18): telefon — 28 dagi foydalanuvchilar.telefon (115); SMS baribir faqat aniq yoqilsa (SUKUT)
    const manzil: Record<Kanal, boolean> = { email: true, telegram: q.telegram, push: q.push, sms: q.sms };
    return soralgan.filter((k) => yoqilgan(k) && manzil[k]);
  }

  /** Worker chaqiradi: bitta (bildirishnoma, kanal) ni yetkazadi. Idempotent: allaqachon `yuborildi` bo'lsa — hech narsa qilmaydi. */
  async yetkaz(ish: YetkazishIshi, yuboruvchilar: Partial<Record<Kanal, Yuboruvchi>>): Promise<"yuborildi" | "otkazildi" | "qayta" | "xato" | "allaqachon"> {
    const c = await this.#db.connect();
    try {
      await c.query("BEGIN");
      // Qatorni qulflaymiz: ikki worker bir ishni bir vaqtda olsa — ikkinchisi kutadi va "allaqachon" ni ko'radi
      const r = await c.query<{ holat: string; foydalanuvchi_id: string; tur: string; sarlavha: string; matn: string; havola: string | null; email: string; telefon: string | null; chat_id: string | null }>(
        `SELECT y.holat, b.foydalanuvchi_id, b.tur, b.sarlavha, b.matn, b.havola, f.email, f.telefon, t.chat_id
           FROM yetkazishlar y JOIN bildirishnomalar b ON b.id = y.bildirishnoma_id JOIN foydalanuvchilar f ON f.id = b.foydalanuvchi_id
           LEFT JOIN telegram_ulanishlar t ON t.foydalanuvchi_id = f.id AND t.faol
          WHERE y.bildirishnoma_id = $1 AND y.kanal = $2 FOR UPDATE OF y`,
        [ish.bildirishnomaId, ish.kanal],
      );
      const q = r.rows[0];
      if (!q || q.holat === "yuborildi" || q.holat === "otkazildi") { await c.query("COMMIT"); return "allaqachon"; }
      const fId = Number(q.foydalanuvchi_id);
      const soni = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM yetkazishlar y JOIN bildirishnomalar b ON b.id = y.bildirishnoma_id
          WHERE b.foydalanuvchi_id = $1 AND y.kanal = $2 AND y.holat = 'yuborildi' AND y.yangilangan_vaqt > now() - interval '1 hour'`,
        [fId, ish.kanal],
      );
      const yangila = (holat: string, xato: string | null) =>
        c.query("UPDATE yetkazishlar SET holat = $3, urinishlar = urinishlar + 1, oxirgi_xato = $4, yangilangan_vaqt = now() WHERE bildirishnoma_id = $1 AND kanal = $2", [ish.bildirishnomaId, ish.kanal, holat, xato]);
      if ((soni.rows[0]?.n ?? 0) >= this.#limit[ish.kanal]) {
        await yangila("otkazildi", `soatlik limit ${String(this.#limit[ish.kanal])}`);
        await c.query("COMMIT");
        return "otkazildi";
      }
      const yub = yuboruvchilar[ish.kanal];
      if (!yub) { await yangila("xato", "yuboruvchi yo'q"); await c.query("COMMIT"); return "xato"; }
      const pushlar = ish.kanal === "push"
        ? (await c.query<{ id: string; endpoint: string; p256dh: string; auth: string }>("SELECT id, endpoint, p256dh, auth FROM push_obunalar WHERE foydalanuvchi_id = $1", [fId])).rows.map((p) => ({ ...p, id: Number(p.id) }))
        : [];
      // Tashqi so'rov tranzaksiya ichida — qulf yetkazish davomida ushlanadi (ataylab: takroriy yuborish yo'q). Uzoq kutish — yuboruvchi timeout'i bilan cheklangan.
      const n = await yub({ foydalanuvchiId: fId, email: q.email, telefon: q.telefon, chatId: q.chat_id, pushlar }, { id: ish.bildirishnomaId, tur: q.tur, sarlavha: q.sarlavha, matn: q.matn, havola: q.havola });
      if (n.holat === "yuborildi") await yangila("yuborildi", null);
      else if (n.holat === "eskirgan") {
        if (ish.kanal === "telegram") await c.query("UPDATE telegram_ulanishlar SET faol = false WHERE foydalanuvchi_id = $1", [fId]);
        if (ish.kanal === "push" && n.pushId !== undefined) await c.query("DELETE FROM push_obunalar WHERE id = $1", [n.pushId]);
        await yangila("xato", "manzil eskirgan");
      } else await yangila(n.holat === "qayta" ? "navbatda" : "xato", n.sabab);
      await c.query("COMMIT");
      return n.holat === "eskirgan" ? "xato" : n.holat;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  /** Navbatga tushmay qolgan (yoki "qayta" holatidagi) ishlar — `yoshSoniya` dan eski 'navbatda' qatorlar. */
  async qolibKetganlar(yoshSoniya = 300, limit = 500): Promise<YetkazishIshi[]> {
    const r = await this.#db.query<{ bildirishnoma_id: string; kanal: Kanal }>(
      "SELECT bildirishnoma_id, kanal FROM yetkazishlar WHERE holat = 'navbatda' AND yangilangan_vaqt < now() - make_interval(secs => $1) ORDER BY yangilangan_vaqt LIMIT $2",
      [yoshSoniya, limit],
    );
    return r.rows.map((q) => ({ bildirishnomaId: Number(q.bildirishnoma_id), kanal: q.kanal }));
  }

  async oqilmaganSoni(fId: number): Promise<number> {
    const r = await this.#db.query<{ n: number }>("SELECT count(*)::int AS n FROM bildirishnomalar WHERE foydalanuvchi_id = $1 AND oqilgan_vaqt IS NULL", [fId]);
    return r.rows[0]?.n ?? 0;
  }

  /** Keyset sahifalash: `oldin` — oldingi sahifaning oxirgi (vaqt, id) si. */
  async royxat(fId: number, limit = 20, oldin?: { vaqt: Date; id: number }): Promise<(Xabar & { oqilgan: boolean; vaqt: Date })[]> {
    const r = await this.#db.query<{ id: string; tur: string; sarlavha: string; matn: string; havola: string | null; oqilgan_vaqt: Date | null; yaratilgan_vaqt: Date }>(
      `SELECT id, tur, sarlavha, matn, havola, oqilgan_vaqt, yaratilgan_vaqt FROM bildirishnomalar
        WHERE foydalanuvchi_id = $1 AND ($2::timestamptz IS NULL OR (yaratilgan_vaqt, id) < ($2, $3))
        ORDER BY yaratilgan_vaqt DESC, id DESC LIMIT $4`,
      [fId, oldin?.vaqt ?? null, oldin?.id ?? null, limit],
    );
    return r.rows.map((q) => ({ id: Number(q.id), tur: q.tur, sarlavha: q.sarlavha, matn: q.matn, havola: q.havola, oqilgan: q.oqilgan_vaqt !== null, vaqt: q.yaratilgan_vaqt }));
  }

  async oqildi(fId: number, idlar: number[] | "hammasi"): Promise<number> {
    const r = idlar === "hammasi"
      ? await this.#db.query("UPDATE bildirishnomalar SET oqilgan_vaqt = now() WHERE foydalanuvchi_id = $1 AND oqilgan_vaqt IS NULL", [fId])
      : await this.#db.query("UPDATE bildirishnomalar SET oqilgan_vaqt = now() WHERE foydalanuvchi_id = $1 AND id = ANY($2::bigint[]) AND oqilgan_vaqt IS NULL", [fId, idlar]);
    return r.rowCount ?? 0;
  }
}
