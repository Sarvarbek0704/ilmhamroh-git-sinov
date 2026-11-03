// ishchi.ts — 29-qism B (holat 45, #46): fon jarayoni — BullMQ worker'lari (eslatmalar, yetkazishlar, tizim). API'dan alohida: og'ir/sekin ish
// (SMTP, push, webhook) API javob vaqtiga ta'sir qilmaydi, alohida masshtablanadi. Ishga tushirish: node src/ishchi.ts (npm run ishchi)
// SIGTERM → worker.close(): yangi ish olinmaydi, boshlanganlari tugaydi (BullMQ o'zi kutadi); keyin ulanishlar yopiladi.
import { Api } from "grammy";
import { configYukla, ConfigXatosi, type Config } from "./config.ts";
import { pgPool } from "./vazifalar/pg-ombor.ts";
import { logYarat } from "./umumiy/log.ts";
import { Sirlar } from "./umumiy/sir.ts";
import { BildirishnomaMarkazi } from "./bildirishnoma/markaz.ts";
import { emailYuboruvchi, pushYuboruvchi, smsYuboruvchi, type Yuboruvchilar } from "./bildirishnoma/yuboruvchilar.ts";
import { Pochta } from "./email/pochta.ts";
import { WebPush } from "./push/webpush.ts";
import { EskizProvayder } from "./sms/sms.ts";
import { telegramYuboruvchi } from "./telegram/bot.ts";
import { FaylOmbori } from "./fayl/s3.ts";
import { xavfsizAgent } from "./webhook/ssrf.ts";
import { NAVBAT, Navbatlar, ishchi, ulanish } from "./navbat/navbat.ts";
import { eslatmaIshlovi, tizimIshlovi, yetkazishIshlovi } from "./navbat/ishlovchilar.ts";
import { relay } from "./navbat/outbox.ts";
import { hodisaIshlovchisi, navbatgaTarqat } from "./navbat/tarqatish.ts";
import { RedisTarqatuvchi } from "./realtime/sse.ts";
import { createClient } from "redis";

let config: Config;
try {
  config = configYukla(process.env);
} catch (x) {
  if (!(x instanceof ConfigXatosi)) throw x;
  console.error(x.message);
  process.exit(78);
}
if (config.REDIS_URL === undefined || config.ISHCHI_DATABASE_URL === undefined) {
  console.error("ishchi: REDIS_URL va ISHCHI_DATABASE_URL kerak");
  process.exit(78);
}
const log = logYarat(config.LOG_LEVEL);
const sirlar = new Sirlar(config.ILOVA_SIRI);
const pool = pgPool(config.ISHCHI_DATABASE_URL, { max: 10, application_name: "vazifalar-ishchi", connectionTimeoutMillis: 5_000 });
pool.on("error", (err) => { log.error({ err }, "pg pool (ishchi): bo'sh ulanish uzildi"); });

const opt = ulanish(config.REDIS_URL);
const navbatlar = new Navbatlar(opt);
const markaz = new BildirishnomaMarkazi(pool, navbatlar.bildirishnomaNavbati());

// Kanallar — sozlangani bo'yicha (yo'q kanal: markaz "yuboruvchi yo'q" deb yozadi)
const pochta = config.SMTP_HOST === undefined ? undefined : new Pochta({
  host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE, requireTLS: config.NODE_ENV === "production" && !config.SMTP_SECURE,
  ...(config.SMTP_USER === undefined || config.SMTP_PASS === undefined ? {} : { user: config.SMTP_USER, pass: config.SMTP_PASS }), from: config.SMTP_FROM,
});
const yuboruvchilar: Yuboruvchilar = {
  ...(pochta === undefined ? {} : { email: emailYuboruvchi(pochta, { obunaKaliti: sirlar.kalit("obuna"), apiUrl: config.API_URL, ilovaUrl: config.ILOVA_URL }) }),
  ...(config.VAPID_OCHIQ === undefined || config.VAPID_YOPIQ === undefined ? {}
    : { push: pushYuboruvchi(new WebPush({ subject: config.VAPID_SUBJECT, publicKey: config.VAPID_OCHIQ, privateKey: config.VAPID_YOPIQ })) }),
  ...(config.ESKIZ_URL === undefined || config.ESKIZ_EMAIL === undefined || config.ESKIZ_PAROL === undefined ? {}
    : { sms: smsYuboruvchi(new EskizProvayder({ baseUrl: config.ESKIZ_URL, email: config.ESKIZ_EMAIL, parol: config.ESKIZ_PAROL, from: config.ESKIZ_FROM, callbackUrl: `${config.API_URL}/v1/sms/callback` }), sirlar.kalit("sms")) }),
  ...(config.TELEGRAM_BOT_TOKEN === undefined ? {}
    : { telegram: telegramYuboruvchi(new Api(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_API_ROOT === undefined ? undefined : { apiRoot: config.TELEGRAM_API_ROOT })) }),
};
const fayllar = config.S3_BUCKET === undefined || config.S3_KALIT === undefined || config.S3_SIR === undefined ? undefined
  : new FaylOmbori({ ...(config.S3_ENDPOINT === undefined ? {} : { endpoint: config.S3_ENDPOINT }), region: config.S3_REGION, kalit: config.S3_KALIT, sir: config.S3_SIR, bucket: config.S3_BUCKET });
const agent = xavfsizAgent();
// holat 50: SSE hodisalari — Redis Stream + Pub/Sub (API nusxalari tinglaydi)
const redis = createClient({ url: config.REDIS_URL });
redis.on("error", (err) => { log.error({ err }, "redis (ishchi): ulanish xatosi"); });
await redis.connect();
const tarqatuvchi = new RedisTarqatuvchi(redis);
const d = {
  ishchi: pool, markaz, yuboruvchilar, yetkazishNavbati: navbatlar.yetkazish, fayllar, webhook: { agent, httpRuxsat: config.NODE_ENV !== "production" },
  hodisa: hodisaIshlovchisi({ ishchi: pool, navbatlar, tarqatuvchi }),
};

await navbatlar.jadvallar();
const workerlar = [
  ishchi(NAVBAT.eslatma, opt, eslatmaIshlovi(d), { concurrency: 5 }),
  // Telegram: bot bo'yicha ~30 xabar/s — 25/s limiter (kanal bo'yicha alohida navbat — keyingi qadam); SMS va email — markazdagi soatlik limit
  ishchi(NAVBAT.yetkazish, opt, yetkazishIshlovi(d), { concurrency: 10, limiter: { max: 25, duration: 1000 } }),
  ishchi(NAVBAT.tizim, opt, tizimIshlovi(d), { concurrency: 1 }),
];
for (const w of workerlar) {
  w.on("failed", (job, err) => { log.warn({ navbat: w.name, ish: job?.id, urinish: job?.attemptsMade, err }, "ish muvaffaqiyatsiz"); });
  w.on("error", (err) => { log.error({ navbat: w.name, err }, "worker xatosi"); });
}
log.info({ yuboruvchilar: Object.keys(yuboruvchilar), fayllar: fayllar !== undefined }, "ishchi: worker'lar ishga tushdi");

// holat 50: outbox relay — har 500 ms (bo'sh bo'lsa); partiya to'la bo'lsa darhol keyingisi. Bir nechta ishchi nusxasi — SKIP LOCKED
const tarqat = navbatgaTarqat(navbatlar);
const relayHolati = { faol: true };
const relayTugadi = (async () => {
  while (relayHolati.faol) {
    const n = await relay(pool, tarqat, 100, (h, err) => { log.warn({ hodisa: h.hodisaId, tur: h.tur, err }, "outbox: tarqatilmadi (qayta urinadi)"); })
      .catch((err: unknown) => { log.error({ err }, "outbox relay xatosi"); return { tarqatildi: 0, xato: 0 }; });
    if (n.tarqatildi < 100) await new Promise((ok) => setTimeout(ok, 500));
  }
})();

let toxtamoqda = false;
async function chiq(signal: string): Promise<void> {
  if (toxtamoqda) return;
  toxtamoqda = true;
  relayHolati.faol = false;
  await relayTugadi;
  await Promise.all(workerlar.map((w) => w.close()));
  redis.destroy();
  await navbatlar.yop();
  pochta?.yop();
  await agent.close();
  await pool.end();
  log.info({ signal }, "ishchi to'xtadi");
  process.exit(0);
}
process.once("SIGTERM", () => { void chiq("SIGTERM"); });
process.once("SIGINT", () => { void chiq("SIGINT"); });
