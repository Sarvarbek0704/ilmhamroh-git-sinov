// cheklov.ts — #26 B-129 (holat 26): tezlik cheklovi (rate limiting). Algoritm — fixed window (oyna boshida hisob 0); kalit — kim/nima bo'yicha
// (IP, hisob+IP, foydalanuvchi). Ombor: Postgres (UNLOGGED jadval, bitta atomik UPSERT) yoki xotira (dev/test, bitta jarayon).
// Sarlavhalar — IETF draft-ietf-httpapi-ratelimit-headers: RateLimit-Policy va RateLimit; 429 da Retry-After (soniya).
// Fixed window kamchiligi: oyna chegarasida 2× portlash (27 t60: 1.05 s da 10 ta, limit 5/s) — login uchun maqbul (limit kichik, oyna uzun); kerak bo'lsa sliding/token bucket (27 #60).
import type { Pool } from "pg";
import type { Request, RequestHandler } from "express";
import { IlovaXatosi } from "./xatolar.ts";

export type Natija = { ruxsat: boolean; son: number; qoldi: number; tiklanishS: number };

export interface Cheklagich {
  /** hisoblagichni 1 ga oshiradi va natija qaytaradi (limitdan oshgan bo'lsa ruxsat: false) */
  ol(kalit: string, limit: number, oynaMs: number): Promise<Natija>;
  /** muvaffaqiyatdan keyin (masalan, to'g'ri login) — hisobni tozalash */
  tozala(kalit: string): Promise<void>;
}

const natija = (son: number, limit: number, tugashMs: number, hozirMs: number): Natija => ({
  ruxsat: son <= limit, son, qoldi: Math.max(0, limit - son), tiklanishS: Math.max(1, Math.ceil((tugashMs - hozirMs) / 1000)),
});

export class PgCheklagich implements Cheklagich {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async ol(kalit: string, limit: number, oynaMs: number): Promise<Natija> {
    // Bitta so'rov, atomik (qator qulfi ON CONFLICT ichida): oyna tugagan bo'lsa — 1 dan, aks holda +1
    const { rows: [q] } = await this.#pool.query<{ son: number; tugash: Date; hozir: Date }>(
      `INSERT INTO tezlik_chegaralari AS t (kalit, son, tugash) VALUES ($1, 1, now() + $2 * interval '1 millisecond')
       ON CONFLICT (kalit) DO UPDATE SET
         son = CASE WHEN t.tugash <= now() THEN 1 ELSE t.son + 1 END,
         tugash = CASE WHEN t.tugash <= now() THEN now() + $2 * interval '1 millisecond' ELSE t.tugash END
       RETURNING son, tugash, now() AS hozir`, [kalit.slice(0, 300), oynaMs]);
    if (q === undefined) throw new Error("cheklov: UPSERT qator qaytarmadi");
    if (Math.random() < 0.01) void this.#pool.query("DELETE FROM tezlik_chegaralari WHERE tugash < now() - interval '1 hour'").catch(() => undefined);
    return natija(q.son, limit, q.tugash.getTime(), q.hozir.getTime());
  }

  async tozala(kalit: string): Promise<void> {
    await this.#pool.query("DELETE FROM tezlik_chegaralari WHERE kalit = $1", [kalit.slice(0, 300)]);
  }
}

/** Redis klienti (node-redis) — faqat kerakli metodlar (ombor-yarat RedisKlient'iga mos) */
type RedisMulti = { incr(k: string): RedisMulti; pExpire(k: string, ms: number, rejim?: "NX"): RedisMulti; pTTL(k: string): RedisMulti; exec(): Promise<unknown[]> };
export type CheklovRedis = { multi(): RedisMulti; del(k: string): Promise<unknown> };

/**
 * 31 #30 (B-221): Postgres cheklagichi har so'rovda bitta UPSERT — bitta foydalanuvchining parallel so'rovlari BITTA qatorni yangilaydi
 * ("issiq qator": qator qulfi ketma-ketlashtiradi, WAL yoziladi; t30 o'lchovi). REDIS_URL bo'lsa — Redis: INCR + PEXPIRE NX bitta MULTI'da (atomik, xotirada).
 * Oyna mantig'i Pg bilan bir xil (qat'iy oyna). Redis uzilsa — xato (guard 500 emas: cheklov.guard.ts qanday ishlasa shunday — Pg bilan bir xil shartnoma).
 */
export class RedisCheklagich implements Cheklagich {
  constructor(private readonly r: CheklovRedis, private readonly prefiks = "vz:cheklov:") {}

  async ol(kalit: string, limit: number, oynaMs: number): Promise<Natija> {
    const k = this.prefiks + kalit.slice(0, 300);
    const [son, , ttl] = (await this.r.multi().incr(k).pExpire(k, oynaMs, "NX").pTTL(k).exec()) as [number, unknown, number];
    const hozir = Date.now();
    return natija(son, limit, hozir + Math.max(0, ttl), hozir);
  }

  async tozala(kalit: string): Promise<void> {
    await this.r.del(this.prefiks + kalit.slice(0, 300));
  }
}

export class XotiraCheklagich implements Cheklagich {
  readonly #m = new Map<string, { son: number; tugash: number }>();
  readonly #soat: () => number;
  constructor(soat: () => number = Date.now) {
    this.#soat = soat;
  }
  ol(kalit: string, limit: number, oynaMs: number): Promise<Natija> {
    const hozir = this.#soat();
    const e = this.#m.get(kalit);
    const y = e === undefined || e.tugash <= hozir ? { son: 1, tugash: hozir + oynaMs } : { son: e.son + 1, tugash: e.tugash };
    this.#m.set(kalit, y);
    if (this.#m.size > 100_000) for (const [k, v] of this.#m) if (v.tugash <= hozir) this.#m.delete(k);
    return Promise.resolve(natija(y.son, limit, y.tugash, hozir));
  }
  tozala(kalit: string): Promise<void> {
    this.#m.delete(kalit);
    return Promise.resolve();
  }
}

/** Testlar va cheklov kerak bo'lmagan joy: hech qachon cheklamaydi (boshqa testlar ko'p login qiladi — cheklov o'zi test/cheklov.test.ts da) */
export class Cheklovsiz implements Cheklagich {
  ol(_kalit: string, limit: number): Promise<Natija> {
    return Promise.resolve({ ruxsat: true, son: 0, qoldi: limit, tiklanishS: 1 });
  }
  tozala(): Promise<void> {
    return Promise.resolve();
  }
}

export class CheklovXatosi extends IlovaXatosi {
  constructor(tiklanishS: number) {
    super(429, `Juda ko'p so'rov — ${String(tiklanishS)} soniyadan keyin urinib ko'ring`, { kod: "tezlik-cheklovi", sarlavha: "Juda ko'p so'rov", httpSarlavhalar: { "Retry-After": String(tiklanishS) } });
  }
}

export type Qoida = { nom: string; limit: number; oynaMs: number; kalit: (req: Request) => string | undefined };

/**
 * Bir nechta qoida: hammasi hisoblanadi, birortasi oshsa — 429. Javobga eng qattiq qoida sarlavhasi. Kalit undefined — qoida o'tkazib yuboriladi.
 * Cheklagich (baza) ishlamasa — so'rov O'TKAZILADI (fail open) va log'ga: cheklov — qo'shimcha himoya, butun API'ni to'xtatmasin (ongli qaror, #29/#31).
 */
export function cheklov(c: Cheklagich, qoidalar: readonly Qoida[], xatoLog?: (x: unknown) => void): RequestHandler {
  return async (req, res, next) => {
    let eng: (Natija & { q: Qoida }) | undefined;
    try {
      for (const q of qoidalar) {
        const k = q.kalit(req);
        if (k === undefined) continue;
        const n = await c.ol(`${q.nom}:${k}`, q.limit, q.oynaMs);
        if (eng === undefined || n.qoldi < eng.qoldi || !n.ruxsat) eng = { ...n, q };
        if (!n.ruxsat) break;
      }
    } catch (x) {
      xatoLog?.(x);
      next();
      return;
    }
    if (eng !== undefined) {
      res.set("RateLimit-Policy", `${String(eng.q.limit)};w=${String(Math.round(eng.q.oynaMs / 1000))}`);
      res.set("RateLimit", `limit=${String(eng.q.limit)}, remaining=${String(eng.qoldi)}, reset=${String(eng.tiklanishS)}`);
      if (!eng.ruxsat) throw new CheklovXatosi(eng.tiklanishS);
    }
    next();
  };
}
