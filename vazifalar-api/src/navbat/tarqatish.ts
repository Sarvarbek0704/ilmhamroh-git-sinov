// tarqatish.ts — 29-qism B (holat 50): outbox hodisasini iste'molchilarga tarqatish (#50).
//   relay (ishchi jarayonda, har 500 ms) → BullMQ `tizim` navbatiga "hodisa" ishi, jobId = hodisa_id (relay takrorlasa ham bitta ish — at-least-once → bir marta)
//   "hodisa" ishlovchisi → (1) SSE (Redis Stream + Pub/Sub), (2) webhook yetkazish qatorlari (206, hodisa_id = webhook-id — idempotent),
//   (3) eslatma: vazifa.muddat → rejalash/bekor, bajarildi/ochirildi → bekor. Har biri idempotent: ish qayta urinilsa ham natija bir xil.
import type { Pool } from "pg";
import type { RedisTarqatuvchi } from "../realtime/sse.ts";
import type { Navbatlar } from "./navbat.ts";
import type { OutboxHodisa } from "./outbox.ts";

export type HodisaMalumoti = { id: number; matn?: string; bajarildi?: boolean; versiya?: number; muddat?: string | null; manba?: string | null };

export function navbatgaTarqat(navbatlar: Navbatlar): (h: OutboxHodisa) => Promise<void> {
  return async (h) => {
    await navbatlar.tizim.add("hodisa", h, { jobId: `h-${h.hodisaId}`, attempts: 8 });
  };
}

/** navbatlar/tarqatuvchi berilmasa — o'sha qism o'tkazib yuboriladi (masalan, Redis'siz test) */
export function hodisaIshlovchisi(d: { ishchi: Pool; navbatlar?: Navbatlar | undefined; tarqatuvchi?: RedisTarqatuvchi | undefined }) {
  return async (h: OutboxHodisa): Promise<{ sse: boolean; webhook: number; eslatma: string }> => {
    const m = h.malumot as HodisaMalumoti;
    let eslatma = "-";
    if (d.navbatlar === undefined) eslatma = "navbatsiz";
    else if (h.tur === "vazifa.muddat") {
      eslatma = m.muddat === null || m.muddat === undefined
        ? `bekor ${String(await d.navbatlar.eslatmaBekor(m.id))}`
        : await d.navbatlar.eslatmaRejala({ vazifaId: m.id, foydalanuvchiId: h.foydalanuvchiId, muddat: m.muddat });
    } else if (h.tur === "vazifa.bajarildi" || h.tur === "vazifa.ochirildi") {
      eslatma = `bekor ${String(await d.navbatlar.eslatmaBekor(m.id))}`;
    }
    if (d.tarqatuvchi !== undefined) await d.tarqatuvchi.nashr(h.foydalanuvchiId, "ozgardi", { manba: m.manba ?? null, tur: h.tur, vazifaId: m.id });
    let webhook = 0;
    if (h.tur !== "vazifa.muddat") {
      const tana = { type: h.tur, timestamp: h.yaratilgan.toISOString(), data: { id: m.id, matn: m.matn, bajarildi: m.bajarildi, versiya: m.versiya } };
      const c = await d.ishchi.connect();
      try {
        await c.query("BEGIN");
        // 206 funksiyasi faqat JORIY foydalanuvchi obunalariga yozadi — kontekst o'rnatiladi (ishchi roli BYPASSRLS bo'lsa ham funksiya shart qo'yadi)
        await c.query("SELECT set_config('ilova.foydalanuvchi_id', $1, true)", [String(h.foydalanuvchiId)]);
        webhook = (await c.query<{ n: number }>("SELECT webhook_hodisa_qosh($1, $2, $3) AS n", [h.tur, h.hodisaId, tana])).rows[0]?.n ?? 0;
        await c.query("COMMIT");
      } catch (x) {
        await c.query("ROLLBACK");
        throw x;
      } finally {
        c.release();
      }
    }
    return { sse: d.tarqatuvchi !== undefined, webhook, eslatma };
  };
}
