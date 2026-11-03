// supertest.test.ts — HTTP integration test PORTSIZ: request(app) ilovani o'zi vaqtinchalik tinglatadi va yopadi.
// listen() ilova.ts da yo'qligi (holat 13) shuning uchun — Nest ilovasining http serverini (listen qilinmagan) beramiz
import { test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { httpIlova } from "./yordamchi.ts";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";
import { configYukla } from "../src/config.ts";

const yangiIlova = () => httpIlova({ ombor: new XotiraOmbori(), corsOriginlar: ["http://localhost:5173"] });

test("supertest: yaratish → Location → o'qish (zanjir: .send().expect())", async () => {
  const app = await yangiIlova();
  const yarat = await request(app)
    .post("/v1/vazifalar")
    .set("X-Request-Id", "supertest-0001")
    .send({ matn: "Non olish #uy" }) // obyekt — supertest o'zi JSON va Content-Type qo'yadi
    .expect(201)
    .expect("Content-Type", /application\/json/)
    .expect("X-Request-Id", "supertest-0001");
  const joy = String(yarat.headers.location);
  assert.equal(joy, "/v1/vazifalar/1");
  const ol = await request(app).get(joy).expect(200).expect("ETag", '"1"');
  assert.deepEqual((ol.body as { teglar: string[] }).teglar, ["uy"]);
});

test("supertest: shartli so'rov — 304 (supertest fetch emas: no-cache qo'shmaydi)", async () => {
  const app = await yangiIlova();
  await request(app).post("/v1/vazifalar").send({ matn: "a" }).expect(201);
  await request(app).get("/v1/vazifalar/1").set("If-None-Match", '"1"').expect(304);
});

test("supertest: Problem Details va CORS preflight", async () => {
  const app = await yangiIlova();
  const r = await request(app).post("/v1/vazifalar").send({ matn: "" }).expect(422).expect("Content-Type", /application\/problem\+json/);
  assert.equal((r.body as { kod: string }).kod, "validatsiya");
  await request(app)
    .options("/v1/vazifalar/1")
    .set("Origin", "http://localhost:5173")
    .set("Access-Control-Request-Method", "PATCH")
    .expect(204)
    .expect("Access-Control-Allow-Origin", "http://localhost:5173");
});

test("supertest agent: bir xil ilova, ketma-ket so'rovlar (cookie bo'lsa saqlanardi — 28-qism)", async () => {
  const agent = request.agent(await yangiIlova());
  await agent.post("/v1/vazifalar").send({ matn: "bir" }).expect(201);
  await agent.post("/v1/vazifalar").send({ matn: "ikki" }).expect(201);
  const r = await agent.get("/v1/vazifalar?fields=matn").expect(200);
  assert.deepEqual((r.body as { vazifalar: { matn: string }[] }).vazifalar.map((v) => v.matn), ["bir", "ikki"]);
});

// 27-qism holat 19 (regressiya): CORS_ORIGINS="https://login.github.io/" — 25-qismda sxema qabul qilardi, lekin sarlavha chiqmasdi
test("CORS: config'dagi oxiri / li origin — Access-Control-Allow-Origin baribir chiqadi", async () => {
  const { CORS_ORIGINS } = configYukla({ CORS_ORIGINS: "https://login.github.io/" });
  const r = await request(await httpIlova({ ombor: new XotiraOmbori(), corsOriginlar: CORS_ORIGINS })).get("/v1/vazifalar").set("Origin", "https://login.github.io");
  assert.equal(r.status, 200);
  assert.equal(r.headers["access-control-allow-origin"], "https://login.github.io");
});
