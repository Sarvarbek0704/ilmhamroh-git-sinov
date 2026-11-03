// chiquvchi.ts — chiquvchi webhook'lar (sql/203): hodisa → har obunaga yetkazish qatori → worker yuboradi (Standard Webhooks imzo), qayta urinish
// (eksponensial + jitter), 410 → obuna o'chadi, jadval tugasa → 'tashlandi' (DLQ), SSRF himoyasi (undici Agent, ulanish paytida IP tekshiruvi) (B-169).
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { fetch as undiciFetch, type Agent } from "undici";
import { sarlavhalar } from "./imzo.ts";
import { urlTekshir } from "./ssrf.ts";

/** Urinishlar orasidagi kechikish (soniya): Svix/Standard Webhooks tavsiyasiga yaqin — jami 117 755 s ≈ 32.7 soat; keyin DLQ. */
export const JADVAL_SONIYA = [5, 30, 120, 600, 1800, 7200, 21600, 43200, 43200] as const;
export const OBUNA_OCHIRISH_CHEGARASI = 20;

/** ±20 % jitter — bir vaqtda yiqilgan minglab yetkazish bir vaqtda qaytib urilmasin (thundering herd). */
export function kechikishMs(urinish: number, tasodif: () => number = Math.random): number | undefined {
  const s = JADVAL_SONIYA[urinish - 1];
  if (s === undefined) return undefined;
  return Math.round(s * 1000 * (0.8 + 0.4 * tasodif()));
}

/** Hodisani shu foydalanuvchining tegishli obunalariga navbatga qo'yadi. Bitta hodisa — bitta `webhook-id` (hamma obunaga bir xil). */
export async function hodisaQosh(pool: Pool, foydalanuvchiId: number, tur: string, malumot: unknown, hodisaId: string = randomUUID()): Promise<number> {
  const tana = { type: tur, timestamp: new Date().toISOString(), data: malumot };
  const r = await pool.query(
    `INSERT INTO webhook_yetkazishlar (obuna_id, hodisa_id, tur, tana)
     SELECT id, $3, $2, $4 FROM webhook_obunalari WHERE foydalanuvchi_id = $1 AND faol AND $2 = ANY(hodisalar)
     ON CONFLICT (obuna_id, hodisa_id) DO NOTHING`,
    [foydalanuvchiId, tur, hodisaId, tana],
  );
  return r.rowCount ?? 0;
}

type Qator = { id: string; obuna_id: string; hodisa_id: string; tana: unknown; urinishlar: number; url: string; sir: string };

/** Vaqti kelgan yetkazishlarni oladi va yuboradi. Ko'p worker parallel ishlashi mumkin (SKIP LOCKED); o'lgan worker qoldirgan 'yuborilmoqda' — muddatdan keyin qayta olinadi. */
export async function yetkazishIshi(pool: Pool, o: { agent: Agent; limit?: number; httpRuxsat?: boolean; portlar?: number[] | "hammasi"; kutishMs?: number; tasodif?: () => number }): Promise<{ yuborildi: number; qayta: number; tashlandi: number }> {
  const kutish = o.kutishMs ?? 10_000;
  const r = await pool.query<Qator>(
    `UPDATE webhook_yetkazishlar y SET holat = 'yuborilmoqda', urinishlar = urinishlar + 1, keyingi_urinish = now() + make_interval(secs => $2)
       FROM webhook_obunalari o
      WHERE y.id IN (SELECT id FROM webhook_yetkazishlar WHERE holat IN ('navbatda', 'yuborilmoqda') AND keyingi_urinish <= now()
                      ORDER BY keyingi_urinish LIMIT $1 FOR UPDATE SKIP LOCKED)
        AND o.id = y.obuna_id
     RETURNING y.id, y.obuna_id, y.hodisa_id, y.tana, y.urinishlar, o.url, o.sir`,
    [o.limit ?? 50, kutish / 1000 + 30],
  );
  const hisob = { yuborildi: 0, qayta: 0, tashlandi: 0 };
  await Promise.all(r.rows.map(async (q) => {
    const tana = JSON.stringify(q.tana);
    let status: number | null = null;
    let xato: string | null = null;
    try {
      const u = urlTekshir(q.url, { ...(o.httpRuxsat === undefined ? {} : { httpRuxsat: o.httpRuxsat }), ...(o.portlar ? { portlar: o.portlar } : {}) });
      const javob = await undiciFetch(u, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "vazifalar-webhook/1", ...sarlavhalar(q.sir, q.hodisa_id, tana) },
        body: tana,
        redirect: "manual", // 3xx — muvaffaqiyat emas; yo'naltirish orqali ichki manzilga o'tib ketmasin
        dispatcher: o.agent,
        signal: AbortSignal.timeout(kutish),
      });
      status = javob.status;
      await javob.body?.cancel(); // javob tanasi kerak emas, ulanishni bo'shatamiz
    } catch (e) {
      xato = e instanceof Error ? `${e.name}: ${(e.cause instanceof Error ? e.cause.message : e.message).slice(0, 200)}` : String(e);
    }
    const ok = status !== null && status >= 200 && status < 300;
    if (ok) {
      hisob.yuborildi++;
      await pool.query("UPDATE webhook_yetkazishlar SET holat = 'yuborildi', oxirgi_status = $2, oxirgi_xato = NULL, yuborilgan_vaqt = now() WHERE id = $1", [q.id, status]);
      await pool.query("UPDATE webhook_obunalari SET ketma_ket_xato = 0 WHERE id = $1", [q.obuna_id]);
      return;
    }
    const kech = status === 410 ? undefined : kechikishMs(q.urinishlar, o.tasodif);
    if (kech === undefined) {
      hisob.tashlandi++;
      await pool.query("UPDATE webhook_yetkazishlar SET holat = 'tashlandi', oxirgi_status = $2, oxirgi_xato = $3 WHERE id = $1", [q.id, status, xato]);
    } else {
      hisob.qayta++;
      await pool.query("UPDATE webhook_yetkazishlar SET holat = 'navbatda', oxirgi_status = $2, oxirgi_xato = $3, keyingi_urinish = now() + make_interval(secs => $4) WHERE id = $1", [q.id, status, xato, kech / 1000]);
    }
    await pool.query(
      "UPDATE webhook_obunalari SET ketma_ket_xato = ketma_ket_xato + 1, faol = faol AND $2 AND ketma_ket_xato + 1 < $3 WHERE id = $1",
      [q.obuna_id, status !== 410, OBUNA_OCHIRISH_CHEGARASI],
    );
  }));
  return hisob;
}
