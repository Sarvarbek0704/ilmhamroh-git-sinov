// kuzatuv.test.ts — 31-qism #26 graceful shutdown (readiness 503 → boshlangan so'rov tugaydi → yangi ulanish yo'q), #27 /health/startup, #28 /metrics (RED,
// marshrut SHABLONI yorlig'i, token). Xotira ombori — bazasiz.
import { test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { ilovaYarat } from "../src/ilova.ts";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";
import { configYukla } from "../src/config.ts";
import { ILOVA_HOLATI, IlovaHolati } from "../src/tokenlar.ts";

const ilova = async (env: Record<string, string> = {}) => {
  const app = await ilovaYarat({ ombor: new XotiraOmbori(), config: configYukla({ LOG_LEVEL: "silent", NODE_ENV: "test", ...env }) });
  await app.init();
  return app;
};

test("#27 /health/startup: boshlanmaguncha 503, keyin 200; #26 yopilmoqda — /health/ready 503, /health/live 200", async () => {
  const app = await ilova();
  const h = app.get<IlovaHolati>(ILOVA_HOLATI);
  const http = app.getHttpServer();
  await request(http).get("/health/startup").expect(503);
  h.boshlandi = true;
  await request(http).get("/health/startup").expect(200);
  await request(http).get("/health/ready").expect(200);
  h.yopilmoqda = true;
  const r = await request(http).get("/health/ready").expect(503);
  assert.match(JSON.stringify(r.body), /yopilish/);
  await request(http).get("/health/live").expect(200);
  await app.close();
});

// #26 yop() xulqi (boshlangan so'rov tugaydi, yangisi rad, keep-alive kutilmaydi) — test/yopish.test.ts (25-qism); bu yerda — readiness qismi (yuqorida)

test("#28 /metrics: RED — yo'l yorlig'i marshrut SHABLONI (/v1/vazifalar/:id), mos kelmagan — 'boshqa'; METRIKA_TOKEN bo'lsa Bearer talab", async () => {
  const app = await ilova({ METRIKA_TOKEN: "metrika-token-lokal-sinov" });
  const http = app.getHttpServer();
  await request(http).post("/v1/vazifalar").send({ matn: "Metrika" }).expect(201);
  await request(http).get("/v1/vazifalar/1").expect(200);
  await request(http).get("/v1/vazifalar/2").expect(404);
  await request(http).get("/yoq/manzil/12345").expect(404);
  await request(http).get("/metrics").expect(401);
  const m = (await request(http).get("/metrics").set("Authorization", "Bearer metrika-token-lokal-sinov").expect(200)).text;
  assert.match(m, /http_sorovlar_jami\{metod="GET",yol="\/v1\/vazifalar\/:id",status="200",ilova="vazifalar-api"\} 1/);
  assert.match(m, /http_sorovlar_jami\{metod="GET",yol="\/v1\/vazifalar\/:id",status="404",ilova="vazifalar-api"\} 1/);
  assert.match(m, /yol="boshqa",status="404"/);
  assert.doesNotMatch(m, /12345/); // haqiqiy URL yorliqqa tushmaydi (kardinallik)
  assert.match(m, /http_sorov_davomiyligi_soniya_bucket\{le="0\.005"/);
  await app.close();
});
