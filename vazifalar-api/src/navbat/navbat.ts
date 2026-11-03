// navbat.ts — BullMQ (Redis) navbatlari: vazifa muddati eslatmasi (delayed, idempotent jobId), bildirishnoma yetkazish (markaz.ts Navbat interfeysi),
// rejali ishlar (job scheduler, Asia/Tashkent), worker sozlamalari (attempts, eksponensial backoff, concurrency, limiter, UnrecoverableError) (B-178…B-182).
// Redis talabi: `maxmemory-policy noeviction` (kanon29-redis shunday) — aks holda Redis ish kalitlarini o'chirib yuborishi mumkin (BullMQ ogohlantiradi).
// 29-qism B (holat 45): Redis klienti — node-redis (`createNodeRedisClient`, BullMQ 6) — vazifalar-api da allaqachon bor (kesh, Telegram, SSE); ioredis
// ikkinchi klient bo'lardi. O'lchov (t45b, 5000 ish): ioredis 657 ms, node-redis 987 ms (~1.5x sekin) — eslatma/yetkazish hajmi uchun yetarli.
import { Queue, Worker, UnrecoverableError, RedisConnection, createNodeRedisClient, type ConnectionOptions, type Job, type Processor } from "bullmq";
import { createClient } from "redis";
import type { Navbat as BildirishnomaNavbati, YetkazishIshi } from "../bildirishnoma/markaz.ts";

export const NAVBAT = { eslatma: "eslatmalar", yetkazish: "yetkazishlar", tizim: "tizim" } as const;

export type EslatmaIshi = { vazifaId: number; foydalanuvchiId: number; muddat: string };

/**
 * BullMQ ulanishi node-redis orqali. `RedisConnection.clientFactory` — jarayon bo'yicha GLOBAL (statik) sozlama: BullMQ har Queue/Worker uchun
 * o'zi ulanish ochadi va shu fabrikani chaqiradi. Shuning uchun jarayon boshida BIR MARTA, birinchi Queue/Worker'dan oldin.
 */
export function ulanish(redisUrl: string): ConnectionOptions {
  RedisConnection.clientFactory = () => createNodeRedisClient(createClient({ url: redisUrl }));
  const u = new URL(redisUrl);
  return { host: u.hostname, port: Number(u.port || 6379), maxRetriesPerRequest: null };
}

const SUKUT = { attempts: 5, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: { age: 24 * 3600, count: 1000 }, removeOnFail: { age: 7 * 24 * 3600 } } as const;

export class Navbatlar {
  readonly eslatma: Queue<EslatmaIshi>;
  readonly yetkazish: Queue<YetkazishIshi>;
  readonly tizim: Queue;
  constructor(ulanishOpt: ConnectionOptions, prefiks = "vz") {
    const o = { connection: ulanishOpt, prefix: prefiks, defaultJobOptions: SUKUT };
    this.eslatma = new Queue<EslatmaIshi>(NAVBAT.eslatma, o);
    this.yetkazish = new Queue<YetkazishIshi>(NAVBAT.yetkazish, o);
    this.tizim = new Queue(NAVBAT.tizim, o);
  }

  /**
   * Muddatdan `oldinMs` oldin eslatma. jobId = vazifa + muddat → bir xil muddat uchun takror qo'shish e'tiborsiz (idempotent);
   * muddat o'zgarsa — eskisi o'chiriladi va yangisi qo'yiladi. O'tib ketgan vaqt — eslatma yo'q.
   */
  async eslatmaRejala(x: EslatmaIshi, oldinMs = 30 * 60_000, hozir = Date.now()): Promise<"qoshildi" | "otgan"> {
    await this.eslatmaBekor(x.vazifaId);
    const kechikish = new Date(x.muddat).getTime() - oldinMs - hozir;
    if (kechikish <= 0) return "otgan";
    await this.eslatma.add("muddat", x, { jobId: `eslatma-${String(x.vazifaId)}-${new Date(x.muddat).getTime().toString(36)}`, delay: kechikish });
    return "qoshildi";
  }

  /** Vazifa o'chirildi/bajarildi/muddati o'zgardi — kutib turgan eslatmalarni olib tashlash. */
  async eslatmaBekor(vazifaId: number): Promise<number> {
    let n = 0;
    for (const j of await this.eslatma.getJobs(["delayed", "waiting"], 0, -1)) {
      if (j.data.vazifaId === vazifaId) { await j.remove(); n++; }
    }
    return n;
  }

  /** Bildirishnoma markazi uchun Navbat: jobId = bildirishnoma + kanal (takror qo'shilmaydi). */
  bildirishnomaNavbati(): BildirishnomaNavbati {
    return {
      qosh: async (ishlar) => {
        await this.yetkazish.addBulk(ishlar.map((i) => ({ name: i.kanal, data: i, opts: { jobId: `b-${String(i.bildirishnomaId)}-${i.kanal}` } })));
      },
    };
  }

  /**
   * Rejali ishlar (Asia/Tashkent): yetim fayllar — har kuni 03:30, qolib ketgan bildirishnomalar — har 5 daqiqa, webhook yetkazishlari — har 10 s
   * (29-qism B, holat 45). Bir nechta API nusxasi chaqirsa ham bitta jadval (upsert).
   */
  async jadvallar(): Promise<void> {
    await this.tizim.upsertJobScheduler("yetim-fayllar", { pattern: "30 3 * * *", tz: "Asia/Tashkent" }, { name: "yetim-fayllar" });
    await this.tizim.upsertJobScheduler("qolib-ketgan", { every: 5 * 60_000 }, { name: "qolib-ketgan" });
    await this.tizim.upsertJobScheduler("saqlash-muddati", { pattern: "15 4 * * *", tz: "Asia/Tashkent" }, { name: "saqlash-muddati" }); // 31 #12
    await this.tizim.upsertJobScheduler("outbox-tozala", { pattern: "0 4 * * *", tz: "Asia/Tashkent" }, { name: "outbox-tozala" }); // holat 50
    await this.tizim.upsertJobScheduler("webhooklar", { every: 10_000 }, { name: "webhooklar", opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } } });
  }

  async yop(): Promise<void> {
    await Promise.all([this.eslatma.close(), this.yetkazish.close(), this.tizim.close()]);
  }
}

/** Worker: doimiy xato (masalan foydalanuvchi o'chirilgan) — `UnrecoverableError` — qayta urinilmaydi. */
export function ishchi<T>(nomi: string, ulanishOpt: ConnectionOptions, ishlov: Processor<T>, o: { concurrency?: number; limiter?: { max: number; duration: number }; prefiks?: string } = {}): Worker<T> {
  return new Worker<T>(nomi, ishlov, {
    connection: ulanishOpt,
    prefix: o.prefiks ?? "vz",
    concurrency: o.concurrency ?? 5,
    ...(o.limiter ? { limiter: o.limiter } : {}),
    stalledInterval: 30_000,
    maxStalledCount: 1,
  });
}

export { UnrecoverableError, type Job };
