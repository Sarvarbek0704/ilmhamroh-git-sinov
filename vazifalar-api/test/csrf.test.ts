// csrf.test.ts — #10 (holat 10): Origin / Sec-Fetch-Site tekshiruvi (sessiyasiz — middleware darajasida; to'liq brauzer sinovi — e2e/csrf.e2e.ts)
import { test } from "vitest";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { csrfHimoya } from "../src/auth/csrf.ts";
import { xatoIshlovchi } from "./xato-ishlovchi.ts";

function ilova() {
  const app = express();
  app.use(csrfHimoya(["http://localhost:5173"]));
  app.all("/x", (_req, res) => { res.sendStatus(204); });
  app.use(xatoIshlovchi(() => undefined));
  return app;
}
const C = "__Host-sessiya=abc";

test("o'zgartiruvchi so'rov + cookie: o'z origin'i va ro'yxatdagi frontend — o'tadi; begona, 'null', boshqa port — 403 csrf", async () => {
  const app = ilova();
  // o'z origin'imiz — so'rovning protokoli + Host sarlavhasi
  await request(app).post("/x").set("Host", "api.example").set("Cookie", C).set("Origin", "http://api.example").expect(204);
  await request(app).post("/x").set("Host", "api.example").set("Cookie", C).set("Origin", "https://api.example").expect(403); // sxema boshqa
  await request(app).delete("/x").set("Cookie", C).set("Origin", "http://localhost:5173").expect(204);
  for (const o of ["https://yovuz.example", "null", "http://localhost:5174", "http://localhost:5173.yovuz.example"]) {
    const r = await request(app).post("/x").set("Cookie", C).set("Origin", o).expect(403);
    assert.equal((r.body as { kod: string }).kod, "csrf", o);
  }
});

test("Origin yo'q: Sec-Fetch-Site cross-site / same-site — 403; same-origin / none / sarlavhasiz (curl) — o'tadi", async () => {
  const app = ilova();
  await request(app).post("/x").set("Cookie", C).set("Sec-Fetch-Site", "cross-site").expect(403);
  await request(app).post("/x").set("Cookie", C).set("Sec-Fetch-Site", "same-site").expect(403);
  await request(app).post("/x").set("Cookie", C).set("Sec-Fetch-Site", "same-origin").expect(204);
  await request(app).post("/x").set("Cookie", C).set("Sec-Fetch-Site", "none").expect(204);
  await request(app).post("/x").set("Cookie", C).expect(204);
});

test("xavfsiz metodlar va cookie'siz so'rovlar tekshirilmaydi", async () => {
  const app = ilova();
  await request(app).get("/x").set("Cookie", C).set("Origin", "https://yovuz.example").expect(204);
  await request(app).post("/x").set("Origin", "https://yovuz.example").expect(204);
});
