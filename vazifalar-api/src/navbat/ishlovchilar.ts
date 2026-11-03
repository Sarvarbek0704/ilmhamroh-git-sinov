// ishlovchilar.ts — 29-qism B (holat 45–48): BullMQ ishlovchilari (ishchi jarayon — src/ishchi.ts). Alohida modul — testda Worker'siz ham chaqiriladi.
//   eslatmalar  — muddatdan oldin: vazifa hali bormi, bajarilmaganmi, muddat o'zgarmaganmi → markaz.bildir (dedup — vazifa + muddat)
//   yetkazishlar — markaz.yetkaz; "qayta" → xato tashlanadi (BullMQ attempts + eksponensial backoff); doimiy xato — markaz holatni yozgan, qayta urinilmaydi
//   tizim       — yetim-fayllar (#48), qolib-ketgan bildirishnomalar (#50 xavfsizlik to'ri), webhooklar (#35 yetkazish)
import type { Pool } from "pg";
import type { Queue } from "bullmq";
import type { Agent } from "undici";
import type { BildirishnomaMarkazi, YetkazishIshi } from "../bildirishnoma/markaz.ts";
import type { Yuboruvchilar } from "../bildirishnoma/yuboruvchilar.ts";
import type { FaylOmbori } from "../fayl/s3.ts";
import { yetimlarniTozala } from "../fayl/metama.ts";
import { yetkazishIshi } from "../webhook/chiquvchi.ts";
import { UnrecoverableError, type EslatmaIshi, type Job } from "./navbat.ts";
import { outboxTozala, type OutboxHodisa } from "./outbox.ts";

export type IshlovBogliqliklari = {
  /** vazifalar_ishchi roli (205) */
  ishchi: Pool;
  markaz: BildirishnomaMarkazi;
  yuboruvchilar: Yuboruvchilar;
  yetkazishNavbati: Queue<YetkazishIshi>;
  fayllar?: FaylOmbori | undefined;
  webhook: { agent: Agent; httpRuxsat: boolean };
  /** holat 50: outbox hodisasini tarqatish (tarqatish.ts) */
  hodisa?: ((h: OutboxHodisa) => Promise<unknown>) | undefined;
};

const sana = (d: Date) => new Intl.DateTimeFormat("uz-Latn-UZ", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);

export function eslatmaIshlovi(d: Pick<IshlovBogliqliklari, "ishchi" | "markaz">) {
  return async (job: Job<EslatmaIshi>): Promise<"yuborildi" | "takror" | "eskirgan"> => {
    const { vazifaId, foydalanuvchiId, muddat } = job.data;
    const q = (await d.ishchi.query<{ matn: string; muddat: Date | null; bajarildi: boolean }>(
      "SELECT matn, muddat, bajarildi FROM vazifalar WHERE id = $1 AND egasi_id = $2 AND ochirilgan_vaqt IS NULL", [vazifaId, foydalanuvchiId])).rows[0];
    // Ish rejalangandan keyin vazifa o'chirilgan/bajarilgan/muddati o'zgargan bo'lsa (bekor qilish yetib kelmagan bo'lsa ham) — eslatma yo'q
    if (q === undefined || q.bajarildi || q.muddat?.getTime() !== new Date(muddat).getTime()) return "eskirgan";
    const b = await d.markaz.bildir(foydalanuvchiId, {
      tur: "vazifa.muddat", sarlavha: "Muddat yaqin", matn: `${q.matn} — ${sana(q.muddat)}`, havola: `/vazifalar/${String(vazifaId)}`,
      dedupKalit: `vazifa:${String(vazifaId)}:muddat:${muddat}`,
    });
    return b.yangi ? "yuborildi" : "takror";
  };
}

export function yetkazishIshlovi(d: Pick<IshlovBogliqliklari, "markaz" | "yuboruvchilar">) {
  return async (job: Job<YetkazishIshi>): Promise<string> => {
    const n = await d.markaz.yetkaz(job.data, d.yuboruvchilar);
    if (n === "qayta") throw new Error(`${job.data.kanal}: vaqtinchalik xato — qayta urinish`);
    return n;
  };
}

export function tizimIshlovi(d: IshlovBogliqliklari) {
  return async (job: Job): Promise<unknown> => {
    switch (job.name) {
      case "yetim-fayllar":
        return d.fayllar === undefined ? { otkazildi: "S3 yo'q" } : yetimlarniTozala(d.ishchi, d.fayllar);
      case "qolib-ketgan": {
        // jobId'ga vaqt qo'shiladi: "b-<id>-<kanal>" nomli eski (failed) ish Redis'da 7 kun turadi — o'sha id bilan qo'shish e'tiborsiz qolardi.
        // Takror yuborish yo'q: markaz.yetkaz idempotent (FOR UPDATE + "allaqachon")
        const l = await d.markaz.qolibKetganlar();
        const t = Date.now().toString(36);
        if (l.length > 0) await d.yetkazishNavbati.addBulk(l.map((i) => ({ name: i.kanal, data: i, opts: { jobId: `b-${String(i.bildirishnomaId)}-${i.kanal}-q${t}` } })));
        return { qaytaQoyildi: l.length };
      }
      case "webhooklar":
        return yetkazishIshi(d.ishchi, { agent: d.webhook.agent, httpRuxsat: d.webhook.httpRuxsat, ...(d.webhook.httpRuxsat ? { portlar: "hammasi" as const } : {}) });
      case "hodisa": {
        if (d.hodisa === undefined) throw new UnrecoverableError("hodisa tarqatuvchisi yo'q");
        // Redis orqali kelgan JSON — Date satrga aylangan
        const h = job.data as OutboxHodisa & { yaratilgan: string | Date };
        return d.hodisa({ ...h, yaratilgan: new Date(h.yaratilgan) });
      }
      case "saqlash-muddati": {
        // 31 #12 (sql/302, 301): saqlash siyosati — yumshoq o'chirilganlar 30 kun, auth qoldiqlari, 13 oydan eski hodisa bo'limlari. vazifalar_ishchi roli
        const vazifalar = Number((await d.ishchi.query<{ n: string }>("SELECT ochirilganlarni_tozala() AS n")).rows[0]?.n ?? 0);
        const auth = (await d.ishchi.query<{ n: Record<string, number> }>("SELECT auth_tozala() AS n")).rows[0]?.n ?? {};
        const hodisaBolimlari = (await d.ishchi.query<{ b: string }>("SELECT hodisa_bolimlari_tozala() AS b")).rows.map((r) => r.b);
        return { vazifalar, auth, hodisa_bolimlari: hodisaBolimlari };
      }
      case "outbox-tozala":
        return { ochirildi: await outboxTozala(d.ishchi) };
      default:
        throw new UnrecoverableError(`noma'lum tizim ishi: ${job.name}`);
    }
  };
}
