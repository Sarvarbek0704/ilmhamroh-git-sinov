// bot.ts — 29-qism B (holat 22): Telegram bot jarayoni (API'dan alohida — bot yiqilsa API ishlayveradi, alohida masshtablanadi).
// Long polling — lokal va bitta nusxa; prodda webhook + secret_token (#25) — SINALMAGAN (haqiqiy token yo'q). Ishga tushirish: node src/bot.ts
// SIGTERM/SIGINT → toxta(): yangi update olinmaydi, ishlanayotganlari tugaydi (10 s gacha), keyin ulanishlar yopiladi.
import { createClient } from "redis";
import type { ConversationData, VersionedState } from "@grammyjs/conversations";
import { configYukla, ConfigXatosi, type Config } from "./config.ts";
import { omborOl, omborYarat } from "./ombor-yarat.ts";
import { pgPool } from "./vazifalar/pg-ombor.ts";
import { logYarat } from "./umumiy/log.ts";
import { toxta, vazifaBot } from "./telegram/bot.ts";
import { dialogSaqlash, PgVazifaManbai } from "./telegram/manba.ts";

let config: Config;
try {
  config = configYukla(process.env);
} catch (x) {
  if (!(x instanceof ConfigXatosi)) throw x;
  console.error(x.message);
  process.exit(78);
}
const { TELEGRAM_BOT_TOKEN: token, ISHCHI_DATABASE_URL: ishchiUrl, REDIS_URL: redisUrl } = config;
if (token === undefined || ishchiUrl === undefined || redisUrl === undefined || (config.SAQLASH !== "postgres" && config.SAQLASH !== "prisma")) {
  console.error("bot: TELEGRAM_BOT_TOKEN, ISHCHI_DATABASE_URL, REDIS_URL va SAQLASH=postgres|prisma kerak");
  process.exit(78);
}
const log = logYarat(config.LOG_LEVEL);
const saqlash = await omborYarat(config, log);
if (saqlash.pool === undefined) throw new Error("bot: ma'lumot pool'i yo'q");
const ishchi = pgPool(ishchiUrl, { max: 3, application_name: "vazifalar-bot", connectionTimeoutMillis: 5_000 });
ishchi.on("error", (err) => { log.error({ err }, "pg pool (bot): bo'sh ulanish uzildi"); });
const redis = createClient({ url: redisUrl, socket: { connectTimeout: 2_000, reconnectStrategy: (n) => Math.min(n * 200, 5_000) } });
redis.on("error", (err) => { log.error({ err }, "redis (bot): ulanish xatosi"); });
await redis.connect();

const manba = new PgVazifaManbai({ ombor: (f) => omborOl(saqlash, f), malumot: saqlash.pool, ishchi, redis });
const bot = vazifaBot(token, manba, {
  ...(config.TELEGRAM_API_ROOT === undefined ? {} : { apiRoot: config.TELEGRAM_API_ROOT }),
  storage: dialogSaqlash<VersionedState<ConversationData>>(redis),
  log: (x) => { log.warn({ xato: x }, "bot: update ishlovida xato"); },
});

let toxtamoqda = false;
async function chiq(signal: string): Promise<void> {
  if (toxtamoqda) return;
  toxtamoqda = true;
  const n = await toxta(bot, 10_000);
  log.info({ signal, ...n }, "bot to'xtadi");
  redis.destroy();
  await ishchi.end();
  await saqlash.yop();
  process.exit(n.kutildi ? 0 : 1);
}
process.once("SIGTERM", () => { void chiq("SIGTERM"); });
process.once("SIGINT", () => { void chiq("SIGINT"); });

await bot.start({
  allowed_updates: ["message", "callback_query", "my_chat_member"],
  onStart: (me) => { log.info({ bot: me.username }, "bot: long polling boshlandi"); },
});
