// main.ts — kirish nuqtasi (25–27 server.ts ning o'rni): Nest ilovasi (config — ConfigModule, ombor — OmborModule, DI ichida) → server →
// jarayon hodisalari. Ishga tushirish: npm run build && npm start (node --env-file-if-exists=.env dist/main.js)
import "reflect-metadata";
import { ConfigXatosi } from "./config.ts";
import type { Config } from "./config.ts";
import { ishgaTushir } from "./ishga-tushir.ts";
import type { Ishlayotgan } from "./ishga-tushir.ts";
import { jarayonniBoshqar } from "./jarayon.ts";
import { CONFIG, ILOVA_HOLATI, JONLI, LOG } from "./tokenlar.ts";
import type { IlovaHolati } from "./tokenlar.ts";
import type { SseHub } from "./realtime/sse.ts";
import type { Log } from "./umumiy/log.ts";

let ishlayotgan: Ishlayotgan;
try {
  // sozlama, log, ombor — hammasi config bo'yicha DI ichida (ConfigModule → configYukla: Zod, fail-fast)
  ishlayotgan = await ishgaTushir({ bogliqliklar: {} });
} catch (x) {
  if (!(x instanceof ConfigXatosi)) throw x; // boshqa xato (baza yo'q, EGASI_ID…) — stack bilan, exit 1
  console.error(x.message);
  process.exit(78); // EX_CONFIG (sysexits.h) — supervisor qayta-qayta ishga tushirmasin, sozlamani tuzatish kerak
}

const { server, manzil, app } = ishlayotgan;
const config = app.get<Config>(CONFIG);
const log = app.get<Log>(LOG);
const holat = app.get<IlovaHolati>(ILOVA_HOLATI);
holat.boshlandi = true; // 31 #27: /health/startup
log.info({ manzil, muhit: config.NODE_ENV, saqlash: config.SAQLASH }, `vazifalar-api: ${manzil}`);
// Signal (SIGTERM/SIGINT) va "let it crash" — o'zimizniki (jarayon.ts): avval HTTP ulanishlar to'g'ri yopiladi (yop — bo'sh keep-alive'lar
// darhol), keyin app.close() — Nest lifecycle hook'lari (OmborModule: pool va Redis). app.enableShutdownHooks() ISHLATILMAYDI — signal
// ikki joyda ushlanib, yopish ikki marta boshlanmasin (#13, t13 o'lchovi)
jarayonniBoshqar(server, {
  info: (x) => { log.info(x); },
  // fatal sinxron yoziladi (pino stdout'ga sinxron) — exit'dan oldin yo'qolmaydi
  fatal: (x, xato) => { log.fatal({ err: xato }, x); },
}, {
  // 30 C (29 holat 38): SSE ulanishlari server.close() dan OLDIN yopiladi (aks holda ular faol so'rov — yopish kutishMs gacha osiladi)
  // 31 #26: avval readiness 503 (holat.yopilmoqda), YOPISH_KECHIKISH_MS kutiladi (balanser sezsin), keyin server.close
  kechikishMs: config.YOPISH_KECHIKISH_MS,
  boshida: () => { holat.yopilmoqda = true; app.get<SseHub | null>(JONLI)?.yop(); },
  oxirida: () => app.close(),
});
