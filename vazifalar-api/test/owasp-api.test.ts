// owasp-api.test.ts — #31 B-134: OWASP API Security Top 10:2023 bo'yicha audit — regressiya to'plami. Har test docs/OWASP-API.md jadvalidagi bitta qatorga mos:
// hujum ssenariysi bitta joyda — kelajakdagi o'zgarish (yangi endpoint, yangi maydon) eski zaiflikni qaytarsa, shu fayl yiqiladi.
import { afterAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";

// Javobda bo'lmasligi kerak bo'lgan ichki maydonlar (BOPLA — ortiqcha ma'lumot)
const ICHKI = /parol|hash|egasi|sir|token|bloklangan|telefon/i;
const kalitlar = (x: unknown): string[] =>
  x !== null && typeof x === "object" ? Object.entries(x).flatMap(([k, v]) => [k, ...kalitlar(v)]) : [];

const baza = await authBaza("owasp");
if (typeof baza === "string") {
  test.skip(`OWASP API (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  beforeEach(() => tozala(pool));
  const ilova = async () => {
    const d = authBogliqliklari(pool);
    return { d, app: await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d }) };
  };

  test("API1 BOLA: begona vazifa — o'qish, o'zgartirish, o'chirish 404 (403 emas — borligi ham oshkor emas); ro'yxatda yo'q", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const dilnoza = await hisobOch(app, d, "dilnoza@example.com");
    const v = await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Azizniki" }).expect(201);
    const id = (v.body as { id: number }).id;
    await request(app).get(`/v1/vazifalar/${String(id)}`).set("Cookie", dilnoza).expect(404);
    await request(app).patch(`/v1/vazifalar/${String(id)}`).set("Cookie", dilnoza).send({ bajarildi: true }).expect(404);
    await request(app).delete(`/v1/vazifalar/${String(id)}`).set("Cookie", dilnoza).expect(404);
    const r = await request(app).get("/v1/vazifalar").set("Cookie", dilnoza).expect(200);
    assert.deepEqual((r.body as { vazifalar: unknown[] }).vazifalar, []);
    await request(app).get(`/v1/vazifalar/${String(id)}`).set("Cookie", aziz).expect(200);
  });

  test("API2 autentifikatsiya: sessiyasiz, soxta cookie, soxta Bearer — 401 (ma'lumot yo'llari ham, /men ham)", async () => {
    const { app } = await ilova();
    await request(app).get("/v1/vazifalar").expect(401);
    await request(app).get("/v1/vazifalar").set("Cookie", "__Host-sessiya=soxta").expect(401);
    await request(app).get("/v1/vazifalar").set("Authorization", "Bearer vz_aaaaaaaa_soxta").expect(401);
    await request(app).get("/v1/auth/men").expect(401);
  });

  test("API3 BOPLA: javoblarda ichki maydon yo'q (/men, vazifa, admin ro'yxati); kiruvchi ortiqcha maydon — 422 (mass assignment)", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const men = await request(app).get("/v1/auth/men").set("Cookie", aziz).expect(200);
    const v = await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Non olish" }).expect(201);
    for (const tana of [men.body, v.body]) {
      assert.deepEqual(kalitlar(tana).filter((k) => ICHKI.test(k)), [], JSON.stringify(tana));
    }
    await pool.query("UPDATE foydalanuvchilar SET rol = 'admin' WHERE email = 'aziz@example.com'");
    const r = await request(app).get("/v1/admin/foydalanuvchilar").set("Cookie", aziz).expect(200);
    assert.deepEqual(kalitlar(r.body).filter((k) => /parol|hash|sir|token|telefon/i.test(k)), []);
    await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "x", egasiId: 2 }).expect(422);
    await request(app).patch(`/v1/vazifalar/${String((v.body as { id: number }).id)}`).set("Cookie", aziz).send({ id: 99 }).expect(422);
  });

  test("API4 resurs iste'moli: limit chegarasi 400, katta tana 413", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    await request(app).get("/v1/vazifalar?limit=100000").set("Cookie", aziz).expect(400);
    await request(app).post("/v1/vazifalar").set("Cookie", aziz).set("Content-Type", "application/json").send(JSON.stringify({ matn: "a".repeat(20_000) })).expect(413);
  });

  test("API5 BFLA: oddiy foydalanuvchi admin yo'llarida 403, sessiyasiz 401", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    await request(app).get("/v1/admin/foydalanuvchilar").expect(401);
    await request(app).get("/v1/admin/foydalanuvchilar").set("Cookie", aziz).expect(403);
    await request(app).post("/v1/admin/foydalanuvchilar/1/bloklash").set("Cookie", aziz).expect(403);
  });

  test("API8 sozlamalar: X-Powered-By yo'q, CSP default-src 'none', xato javobida stack yo'q", async () => {
    const { app } = await ilova();
    const r = await request(app).get("/v1/yoq-yol").expect(404);
    assert.equal(r.headers["x-powered-by"], undefined);
    assert.match(String(r.headers["content-security-policy"]), /default-src 'none'/);
    assert.doesNotMatch(JSON.stringify(r.body), /at .+\.ts:\d+/);
  });

  test("API9 inventar: versiyasiz yo'llardan faqat /vazifalar va /teglar (Deprecation bilan); /eksportlar, /auth, /admin — 404", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const eski = await request(app).get("/vazifalar").set("Cookie", aziz).expect(200);
    assert.ok(eski.headers["deprecation"] !== undefined);
    for (const yol of ["/eksportlar/x", "/auth/men", "/admin/foydalanuvchilar"]) {
      await request(app).get(yol).set("Cookie", aziz).expect(404);
    }
  });
}
