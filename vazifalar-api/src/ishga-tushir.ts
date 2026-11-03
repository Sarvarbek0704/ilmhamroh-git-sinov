// ishga-tushir.ts — Nest ilovasi, http server timeout'lari va tinglash
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ilovaYarat } from "./ilova.ts";
import type { Bogliqliklar } from "./ilova.ts";
import { XotiraOmbori } from "./vazifalar/xotira-ombor.ts";
import { CONFIG } from "./tokenlar.ts";
import type { Config } from "./config.ts";

// 27 testlari (pg-ombor, prisma-ombor) omborYarat'ni shu fayldan import qiladi — eski yo'l saqlanadi
export { omborYarat } from "./ombor-yarat.ts";
export type { OmborLogi, RedisKlient, Saqlash } from "./ombor-yarat.ts";
export { omborOl } from "./ombor-yarat.ts";

export type Ishlayotgan = { server: Server; manzil: string; app: NestExpressApplication };

type Sozlama = { port?: number; host?: string; bogliqliklar?: Bogliqliklar };

/** port/host berilmasa — config'dan (PORT, HOST); testlar port 0 (tasodifiy) beradi */
export async function ishgaTushir({ port, host, bogliqliklar = { ombor: new XotiraOmbori() } }: Sozlama = {}): Promise<Ishlayotgan> {
  const app = await ilovaYarat(bogliqliklar);
  const c = app.get<Config>(CONFIG);
  const p = port ?? c.PORT;
  const h = host ?? c.HOST;
  // Nest http serverni NestFactory.create() da o'zi yaratadi — timeout'larni listen() dan OLDIN shu obyektga beramiz
  const server = app.getHttpServer();
  // Load balancer (nginx, ALB) bo'sh ulanishni ~60 s ushlaydi — Node undan KEYIN yopsin (B-70)
  server.keepAliveTimeout = 65_000;
  // Slowloris: sarlavhalar 10 s ichida to'liq kelmasa — 408 (t07)
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  await app.listen(p, h); // EADDRINUSE — rad etilgan Promise
  const { port: haqiqiy } = server.address() as AddressInfo;
  return { server, manzil: `http://${h}:${String(haqiqiy)}`, app };
}
