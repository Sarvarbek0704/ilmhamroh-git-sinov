// api-kalit.test.ts — #22 (holat 22): API kalitlari (yaratish, ruxsatlar, bekor, aylantirish, muddat, bloklangan egasi, bazada faqat HMAC) va servislararo HMAC imzo.
import { afterAll, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import request from "supertest";
import express from "express";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { hmacImzo, imzoSatri, servisImzosi } from "../src/auth/api-kalit.ts";
import { xatoIshlovchi } from "./xato-ishlovchi.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";

describe("servislararo HMAC imzo", () => {
  const SIR = randomBytes(32);
  let hozir = 1_800_000_000_000;
  const app = express();
  app.use(express.json({ verify: (req, _r, buf) => { (req as express.Request).xomTana = buf; } }));
  app.post("/ichki", servisImzosi(SIR, 300, () => hozir), (req, res) => { res.json(req.body); });
  app.use(xatoIshlovchi(() => undefined));
  const yubor = (tana: string, o: { vaqt?: number; nonce?: string; sir?: Buffer; boshqaTana?: string } = {}) => {
    const vaqt = String(Math.floor((o.vaqt ?? hozir) / 1000));
    const nonce = o.nonce ?? randomBytes(12).toString("base64url");
    const imzo = hmacImzo(o.sir ?? SIR, imzoSatri("POST", "/ichki", vaqt, nonce, tana));
    return request(app).post("/ichki").set("Content-Type", "application/json").set("X-Vaqt", vaqt).set("X-Nonce", nonce).set("X-Imzo", imzo).send(o.boshqaTana ?? tana);
  };

  test("to'g'ri imzo — 200; boshqa sir, o'zgartirilgan tana, 6 daqiqa eski, takror nonce, sarlavhasiz — 401 imzo-xato", async () => {
    await yubor('{"vazifa":1}').expect(200);
    await yubor('{"vazifa":1}', { sir: randomBytes(32) }).expect(401);
    await yubor('{"vazifa":1}', { boshqaTana: '{"vazifa":2}' }).expect(401);
    await yubor('{"vazifa":1}', { boshqaTana: '{"vazifa": 1}' }).expect(401); // bitta bo'shliq ham — xom baytlar imzolanadi
    await yubor('{"vazifa":1}', { vaqt: hozir - 360_000 }).expect(401);
    await yubor('{"vazifa":1}', { nonce: "takroriy-nonce-12345" }).expect(200);
    const r = await yubor('{"vazifa":1}', { nonce: "takroriy-nonce-12345" }).expect(401);
    assert.match((r.body as { detail: string }).detail, /takror/);
    await request(app).post("/ichki").send({ a: 1 }).expect(401);
    hozir += 700_000; // oyna o'tdi — eski nonce xotiradan tozalanadi, lekin vaqt baribir rad etadi
    await yubor('{"vazifa":1}', { vaqt: hozir - 700_000, nonce: "takroriy-nonce-12345" }).expect(401);
  });
});

const baza = await authBaza("apikalit");
if (typeof baza === "string") {
  test.skip(`API kalitlari (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  const d = authBogliqliklari(pool);
  const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, corsOriginlar: ["http://localhost:5173"] });
  let c = "";
  beforeEach(async () => { await tozala(pool); c = await hisobOch(app, d, "aziz@example.com"); });
  const yarat = async (ruxsatlar: string[], muddatKun?: number) =>
    ((await request(app).post("/v1/auth/api-kalitlar").set("Cookie", c).send({ nom: "Skript", ruxsatlar, ...(muddatKun === undefined ? {} : { muddatKun }) }).expect(201)).body as { id: number; kalit: string; prefiks: string });

  test("yaratish: vz_<8>_<43>, bir marta; ro'yxatda faqat prefiks; bazada sir yo'q (HMAC)", async () => {
    const k = await yarat(["vazifalar:oqish"]);
    assert.match(k.kalit, /^vz_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    const l = (await request(app).get("/v1/auth/api-kalitlar").set("Cookie", c).expect(200)).body as { kalitlar: Record<string, unknown>[] };
    assert.equal(l.kalitlar[0]?.["korinish"], `vz_${k.prefiks}_…`);
    assert.ok(!JSON.stringify(l).includes(k.kalit.slice(12)));
    const { rows } = await pool.query<{ t: string }>("SELECT k::text AS t FROM api_kalitlar k");
    assert.ok(!(rows[0]?.t ?? "").includes(k.kalit.slice(12, 30)));
  });

  test("ruxsatlar: oqish — GET 200, POST 403; yozish — POST 201 (begona Origin bilan ham — cookie yo'q, CSRF emas)", async () => {
    const o = await yarat(["vazifalar:oqish"]);
    const y = await yarat(["vazifalar:yozish", "vazifalar:oqish"]);
    await request(app).get("/v1/vazifalar").set("Authorization", `Bearer ${o.kalit}`).expect(200);
    const r = await request(app).post("/v1/vazifalar").set("Authorization", `Bearer ${o.kalit}`).send({ matn: "x" }).expect(403);
    assert.equal((r.body as { kod: string }).kod, "ruxsat-yoq");
    await request(app).post("/v1/vazifalar").set("Authorization", `Bearer ${y.kalit}`).set("Origin", "https://yovuz.example").send({ matn: "Skriptdan" }).expect(201);
  });

  test("kalit auth yo'llarini boshqara olmaydi: kalitlar, /men, admin — 401; yaroqsiz kalit — 401 + WWW-Authenticate Bearer", async () => {
    const k = await yarat(["vazifalar:oqish", "vazifalar:yozish"]);
    const b = `Bearer ${k.kalit}`;
    await request(app).get("/v1/auth/api-kalitlar").set("Authorization", b).expect(401);
    await request(app).post("/v1/auth/api-kalitlar").set("Authorization", b).send({ nom: "x", ruxsatlar: ["vazifalar:oqish"] }).expect(401);
    await request(app).get("/v1/auth/men").set("Authorization", b).expect(401);
    await request(app).get("/v1/admin/foydalanuvchilar").set("Authorization", b).expect(401);
    // oxirgi belgini ALBATTA boshqasiga almashtirish (holat 25 da flaky: oxirgi belgi 'A' bo'lsa kalit o'zgarmasdi — 1/64)
    for (const x of [`${k.kalit.slice(0, -1)}${k.kalit.endsWith("A") ? "B" : "A"}`, "vz_aaaaaaaa_" + "A".repeat(43), "boshqa-token"]) {
      const r = await request(app).get("/v1/vazifalar").set("Authorization", `Bearer ${x}`).expect(401);
      assert.match(String(r.headers["www-authenticate"]), /^Bearer/);
    }
  });

  test("bekor, aylantirish (eski 24 soat yashaydi), muddat, bloklangan egasi — 401", async () => {
    const a = await yarat(["vazifalar:oqish"]);
    const yangi = (await request(app).post(`/v1/auth/api-kalitlar/${String(a.id)}/aylantirish`).set("Cookie", c).expect(201)).body as { id: number; kalit: string };
    for (const k of [a.kalit, yangi.kalit]) await request(app).get("/v1/vazifalar").set("Authorization", `Bearer ${k}`).expect(200);
    const { rows } = await pool.query<{ s: number }>("SELECT round(extract(epoch FROM tugash_vaqti - now()) / 3600)::int AS s FROM api_kalitlar WHERE id = $1", [a.id]);
    assert.equal(rows[0]?.s, 24);
    await pool.query("UPDATE api_kalitlar SET tugash_vaqti = now() - interval '1 second' WHERE id = $1", [a.id]);
    await request(app).get("/v1/vazifalar").set("Authorization", `Bearer ${a.kalit}`).expect(401);
    await request(app).delete(`/v1/auth/api-kalitlar/${String(yangi.id)}`).set("Cookie", c).expect(204);
    await request(app).get("/v1/vazifalar").set("Authorization", `Bearer ${yangi.kalit}`).expect(401);
    const b = await yarat(["vazifalar:oqish"], 30);
    await pool.query("UPDATE foydalanuvchilar SET bloklangan_vaqt = now()");
    await request(app).get("/v1/vazifalar").set("Authorization", `Bearer ${b.kalit}`).expect(401);
  });

  test("begona kalitni bekor qilish — 404 (IDOR)", async () => {
    const a = await yarat(["vazifalar:oqish"]);
    const dilnoza = await hisobOch(app, d, "dilnoza@example.com");
    await request(app).delete(`/v1/auth/api-kalitlar/${String(a.id)}`).set("Cookie", dilnoza).expect(404);
    await request(app).get("/v1/vazifalar").set("Authorization", `Bearer ${a.kalit}`).expect(200);
  });
}
