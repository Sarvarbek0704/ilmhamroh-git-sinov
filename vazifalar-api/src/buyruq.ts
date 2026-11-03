// buyruq.ts — #63 NS-62: standalone ilova (HTTP'siz) — o'sha modullar, o'sha DI, o'sha config; terminal buyrug'i yoki cron skripti uchun.
//   npm run buyruq -- teglar          — teglar va soni (jadval)
//   npm run buyruq -- eksport [csv|json] > fayl  — hamma vazifalar stdout'ga (EksportService mantiqi, fon ishisiz)
// NestFactory.createApplicationContext — controller'lar, HTTP server, middleware YO'Q; provider'lar va lifecycle hook'lar BOR (pool yopiladi)
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.ts";
import { XotiraIdempotentlikOmbori } from "./umumiy/idempotentlik.ts";
import { VazifalarService } from "./vazifalar/vazifalar.service.ts";
import { csvQator } from "./umumiy/csv.ts";
import { ConfigXatosi } from "./config.ts";
import type { Config } from "./config.ts";
import { ClsService } from "nestjs-cls";
import { CLS_EGASI, CONFIG } from "./tokenlar.ts";
import { pino } from "pino";
import { logYarat } from "./umumiy/log.ts";

const LOG_DARAJALARI = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

const [buyruq, format = "csv"] = process.argv.slice(2);
if (buyruq !== "teglar" && buyruq !== "eksport") {
  console.error("Foydalanish: npm run buyruq -- teglar | eksport [csv|json]");
  process.exit(64); // EX_USAGE
}

let ctx;
try {
  ctx = await NestFactory.createApplicationContext(AppModule.forRoot({ idempotentlikOmbori: new XotiraIdempotentlikOmbori(),
    // 31 (30-qism ochiq xatosi): log — STDERR'ga. stdout — buyruq natijasi (`eksport csv > fayl`); avval pino logi stdout'ga tushib CSV oxirida JSON qatorlar qolardi
    log: logYarat(LOG_DARAJALARI.has(process.env["LOG_LEVEL"] ?? "") ? (process.env["LOG_LEVEL"] ?? "info") : "info", pino.destination({ dest: 2, sync: true })) }), { logger: ["error", "warn"], abortOnError: false });
} catch (x) {
  if (!(x instanceof ConfigXatosi)) throw x;
  console.error(x.message);
  process.exit(78);
}
// 31: 30-qism B dan beri VazifalarService egasini CLS'dan oladi (so'rov kontekstida); CLI'da so'rov yo'q → "egasi aniqlanmagan (CLS)" bilan yiqilardi
// (31-qism holat 30 da topildi). Kontekst qo'lda: egasi — EGASI_ID (config; postgres/prisma da qaysi foydalanuvchi eksport qilinishi)
const cls = ctx.get(ClsService);
cls.enter();
cls.set(CLS_EGASI, ctx.get<Config>(CONFIG).EGASI_ID);
try {
  const xizmat = ctx.get(VazifalarService);
  if (buyruq === "teglar") {
    console.table((await xizmat.teglar()).map(({ teg, soni }) => ({ teg, soni })));
  } else {
    // kursor bilan bo'lak-bo'lak (100 tadan) — katta ro'yxat xotiraga birdan yuklanmaydi
    const ustunlar = ["id", "matn", "bajarildi", "teglar", "yaratildi", "yangilandi"] as const;
    if (format === "csv") process.stdout.write(csvQator(ustunlar));
    let keyin: (string | number | boolean)[] | undefined;
    let birinchi = true;
    if (format === "json") process.stdout.write("[");
    for (;;) {
      const n = await xizmat.royxat({ filtr: {}, saralash: [], limit: 100, sahifa: keyin === undefined ? { tur: "kursor" } : { tur: "kursor", keyin } });
      for (const v of n.vazifalar) {
        process.stdout.write(format === "csv" ? csvQator([v.id, v.matn, v.bajarildi, v.teglar.join(" "), v.yaratildi, v.yangilandi]) : (birinchi ? "" : ",") + JSON.stringify(v));
        birinchi = false;
      }
      if (!n.borKeyingi || n.keyingi === undefined) break;
      keyin = n.keyingi;
    }
    if (format === "json") process.stdout.write("]\n");
  }
} finally {
  // @Interval taymerlari va pool — yopilmasa jarayon tugamaydi
  await ctx.close();
}
