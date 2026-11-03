// ombor-yarat.ts — config bo'yicha ombor (xotira, fayl, pg, prisma, + Redis kesh) va uni yopish (30-qism: 27 ishga-tushir.ts dan ajratildi;
// B bosqichi — 28-qism o'zgarishlari: postgres/prisma — foydalanuvchi bo'yicha FABRIKA va auth uchun pool). OmborModule.forRootAsync() shu funksiyani chaqiradi
import type { OmborFabrikasi } from "./vazifalar/ombor.ts";
import type { Config } from "./config.ts";
import { XotiraOmbori } from "./vazifalar/xotira-ombor.ts";
import { FaylOmbori } from "./vazifalar/fayl-ombor.ts";
import type { VazifaOmbori } from "./vazifalar/ombor.ts";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PgOmbori, pgPool } from "./vazifalar/pg-ombor.ts";
import { PrismaOmbori } from "./vazifalar/prisma-ombor.ts";
import { PrismaClient } from "./generated/prisma/client.ts";
import { koddagiMigratsiyalar, migratsiyaHolati } from "./umumiy/migratsiya.ts";
import { createClient } from "redis";
import { KeshliOmbor } from "./vazifalar/kesh-ombor.ts";

/** omborYarat uchun log — pino Logger shu shaklga mos (testda oddiy obyekt) */
export type OmborLogi = { error: (obj: { err: unknown }, xabar: string) => void; warn?: (obj: object, xabar: string) => void };

/**
 * Holat 40: baza migratsiyalari koddagi bilan mosmi (#40). production'da mos kelmasa — ishga TUSHMAYDI (yarim deploy qilingan kod eski
 * sxemada ishlab ma'lumotni buzmasin); boshqa muhitda — ogohlantirish. Migratsiyani server qo'llamaydi — `npm run db:migrate` deploy qadami.
 */
async function migratsiyaniTekshir(pool: pg.Pool, production: boolean, log?: OmborLogi): Promise<void> {
  const h = await migratsiyaHolati(pool, await koddagiMigratsiyalar());
  if (h.tur === "mos") return;
  const xabar = h.tur === "nomalum" ? h.sabab : `migratsiyalar ${h.tur}: ${h.nomlar.join(", ")} — avval npm run db:migrate`;
  if (production && h.tur !== "nomalum") throw new Error(xabar);
  log?.warn?.({ migratsiya: h }, xabar);
}


/**
 * Ombor va uni yopish (server to'xtaganda). xotira/fayl — bitta ombor (dev, bitta foydalanuvchi); postgres/prisma — foydalanuvchi bo'yicha
 * fabrika (28-qism #07: har so'rov o'z egasi bilan) va pool (auth ombori uchun)
 */
export type Saqlash = { ombor: VazifaOmbori | OmborFabrikasi; yop: () => Promise<void>; pool?: pg.Pool; redis?: RedisKlient };

function redisYarat(url: string) {
  return createClient({ url, disableOfflineQueue: true, socket: { connectTimeout: 2_000, reconnectStrategy: (n) => Math.min(n * 200, 5_000) } });
}
/** C bosqich (29-qism holat 22): kesh klienti boshqa ehtiyojlarga ham beriladi (Telegram ulash tokeni, SSE) — ikkinchi ulanish shart emas */
export type RedisKlient = ReturnType<typeof redisYarat>;

/** Saqlash'dan aniq foydalanuvchining ombori (testlar va skriptlar uchun) */
export function omborOl(s: Pick<Saqlash, "ombor">, egasiId: number): VazifaOmbori {
  return typeof s.ombor === "function" ? s.ombor(egasiId) : s.ombor;
}

/** SAQLASH=xotira|fayl|postgres — qolgan kod VazifaOmbori interfeysini biladi, xolos */
export async function omborYarat(
  config: Pick<Config, "SAQLASH" | "FAYL_YOLI" | "DATABASE_URL" | "PG_POOL_MAX" | "PG_STATEMENT_TIMEOUT"> & Partial<Pick<Config, "NODE_ENV" | "REDIS_URL" | "KESH_TTL">>,
  log?: OmborLogi,
): Promise<Saqlash> {
  const s = await asosiyOmbor(config, log);
  if (config.REDIS_URL === undefined || config.SAQLASH === "xotira" || config.SAQLASH === "fayl") return s;
  // Redis kesh (holat 58). disableOfflineQueue: ulanish yo'q paytda buyruq navbatda kutmasin — darhol xato, KeshliOmbor ombordan oladi
  const redis = redisYarat(config.REDIS_URL);
  redis.on("error", (err) => { log?.error({ err }, "redis: ulanish xatosi"); });
  try {
    await redis.connect();
  } catch (x) {
    await s.yop();
    throw x;
  }
  const sozlama = { ttlS: config.KESH_TTL ?? 60, ...(log?.warn === undefined ? {} : { log: { warn: log.warn } }) };
  // kesh kalitlari egasi bo'yicha (vz:<egasi>:…) — har foydalanuvchining keshi va avlodi alohida
  const ombor: OmborFabrikasi = (egasi) => new KeshliOmbor(omborOl(s, egasi), redis, egasi, sozlama);
  return { ...s, ombor, redis, yop: async () => { redis.destroy(); await s.yop(); } };
}

async function asosiyOmbor(
  config: Pick<Config, "SAQLASH" | "FAYL_YOLI" | "DATABASE_URL" | "PG_POOL_MAX" | "PG_STATEMENT_TIMEOUT"> & Partial<Pick<Config, "NODE_ENV">>,
  log?: OmborLogi,
): Promise<Saqlash> {
  const hechnarsa = (): Promise<void> => Promise.resolve();
  switch (config.SAQLASH) {
    case "xotira":
      return { ombor: new XotiraOmbori(), yop: hechnarsa };
    case "fayl":
      return { ombor: await FaylOmbori.och(config.FAYL_YOLI), yop: hechnarsa };
    case "postgres": {
      if (config.DATABASE_URL === undefined) throw new Error("DATABASE_URL yo'q"); // config.ts refine buni oldinroq ushlaydi
      const pool = pgPool(config.DATABASE_URL, {
        max: config.PG_POOL_MAX,
        // bo'sh ulanish 30 s da yopiladi; ulanish 5 s ichida berilmasa — xato (pool leak'ni darhol ko'rsatadi, #44)
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        statement_timeout: config.PG_STATEMENT_TIMEOUT,
      });
      // Bo'sh turgan ulanish uzilsa (server qayta ishga tushdi) — pool 'error' chiqaradi; tinglovchisiz jarayon yiqiladi.
      // Jim yutmaymiz (27-qism holat 19, 26 kuchaytiruvchisi topgan): log'ga — aks holda baza qayta ishga tushgani hech qayerda ko'rinmaydi.
      // Pool o'sha ulanishni o'zi tashlaydi va keyingi so'rovga yangisini ochadi — jarayon to'xtamaydi
      pool.on("error", (err) => { log?.error({ err }, "pg pool: bo'sh ulanish uzildi"); });
      // Fail-fast: baza yoki sxema yo'q bo'lsa — ishga tushmaymiz. 28-qism #07: EGASI_ID tekshiruvi olib tashlandi — egasi endi sessiyadan
      try {
        await pool.query("SELECT 1 FROM foydalanuvchilar LIMIT 1");
        await migratsiyaniTekshir(pool, config.NODE_ENV === "production", log);
      } catch (x) {
        await pool.end();
        throw x;
      }
      return { ombor: (egasi) => new PgOmbori(pool, egasi), yop: () => pool.end(), pool };
    }
    case "prisma": {
      if (config.DATABASE_URL === undefined) throw new Error("DATABASE_URL yo'q");
      // Pool'ni o'zimiz yaratib adapter'ga beramiz: timeout'lar, application_name va "error" tinglovchisi bizning nazoratda.
      // pgPool() EMAS — u bigint'ni Number qiladi (TURLAR), Prisma esa bigint kutadi
      const pool = new pg.Pool({
        connectionString: config.DATABASE_URL,
        application_name: "vazifalar-api",
        max: config.PG_POOL_MAX,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        statement_timeout: config.PG_STATEMENT_TIMEOUT,
      });
      pool.on("error", (err) => { log?.error({ err }, "pg pool (prisma): bo'sh ulanish uzildi"); });
      const db = new PrismaClient({ adapter: new PrismaPg(pool) });
      const yop = async (): Promise<void> => {
        await db.$disconnect();
        await pool.end();
      };
      try {
        await db.foydalanuvchi.count({ take: 1 });
        await migratsiyaniTekshir(pool, config.NODE_ENV === "production", log);
      } catch (x) {
        await yop();
        throw x;
      }
      return { ombor: (egasi) => new PrismaOmbori(db, egasi), yop, pool };
    }
  }
}
