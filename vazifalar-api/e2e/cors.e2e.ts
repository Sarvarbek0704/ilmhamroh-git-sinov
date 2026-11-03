// cors.e2e.ts — #25 B-128 (holat 25): CORS haqiqiy brauzerda — frontend boshqa origin'da (http://localhost:<p>, bir sayt), cookie sessiyasi bilan.
// (1) ro'yxatdagi origin: fetch(credentials: "include") — javob o'qiladi, cookie yuboriladi; (2) ro'yxatda yo'q origin — brauzer javobni JS'ga BERMAYDI;
// (3) "Access-Control-Allow-Origin: *" + credentials — brauzer rad etadi (alohida soxta server); (4) credentials'siz fetch — cookie yuborilmaydi → 401.
import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import type { Browser } from "playwright";
import { authBaza, hisobOch, tozala } from "../test/auth-yordam.ts";
import { expressIlova } from "../test/yordamchi.ts";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";
import { api, brauzer, sahifaServer } from "./yordam.ts";

const baza = await authBaza("e2e_cors");
if (typeof baza === "string") {
  test.skip(`CORS e2e — ${baza}`, () => {});
} else {
  const pool = baza;
  let b: Browser;
  const ruxsat = await sahifaServer(() => "<!doctype html><p>frontend</p>");
  const begona = await sahifaServer(() => "<!doctype html><p>begona</p>");
  const FRONT = `http://localhost:${String(ruxsat.port)}`;
  const a = await api(pool, { corsOriginlar: [FRONT] });
  beforeAll(async () => { b = await brauzer(); await tozala(pool); });
  afterAll(async () => { await b.close(); await a.yop(); ruxsat.server.close(); begona.server.close(); await pool.end(); });

  /** brauzer kontekstiga sessiya: API sahifasida (bir origin) parol bilan kirish */
  async function kirganKontekst() {
    await hisobOch(await expressIlova({ ombor: new XotiraOmbori(), auth: a.auth }), a.auth, `cors${String(Date.now())}@example.com`);
    const ctx = await b.newContext();
    const email = String((await pool.query<{ e: string }>("SELECT email AS e FROM foydalanuvchilar ORDER BY id DESC LIMIT 1")).rows[0]?.e);
    const r = await ctx.request.post(`${a.asos}/v1/auth/kirish`, { data: { email, parol: "Bahor-choyxona-2026" } });
    assert.equal(r.status(), 200);
    return ctx;
  }
  const yubor = (p: import("playwright").Page, url: string, credentials: RequestCredentials) => p.evaluate(async ([u, c]) => {
    try { const r = await fetch(u, { credentials: c }); return `${String(r.status)} ${await r.text()}`.slice(0, 80); } catch (x) { return `xato: ${String(x)}`; }
  }, [url, credentials] as const);

  test("ro'yxatdagi origin + credentials: include — 200 va javob o'qiladi; credentials'siz — cookie yo'q, 401", async () => {
    const ctx = await kirganKontekst();
    const p = await ctx.newPage();
    await p.goto(`${FRONT}/`);
    assert.match(await yubor(p, `${a.asos}/v1/auth/men`, "include"), /^200 \{"foydalanuvchi"/);
    assert.match(await yubor(p, `${a.asos}/v1/auth/men`, "omit"), /^401/);
    await ctx.close();
  });

  test("ro'yxatda yo'q origin — brauzer javobni bermaydi (TypeError), garchi server so'rovni bajargan bo'lsa ham", async () => {
    const ctx = await kirganKontekst();
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${String(begona.port)}/`);
    assert.match(await yubor(p, `${a.asos}/v1/auth/men`, "include"), /^xato: TypeError/);
    await ctx.close();
  });

  test("'*' + Access-Control-Allow-Credentials: true — brauzer rad etadi (spetsifikatsiya); '*' credentials'siz — ishlaydi", async () => {
    const yomon = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.end(`{"cookie":${JSON.stringify(req.headers.cookie ?? null)}}`);
    });
    await new Promise<void>((r) => yomon.listen(0, "127.0.0.1", r));
    const url = `http://localhost:${String((yomon.address() as AddressInfo).port)}/`;
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    await p.goto(`${FRONT}/`);
    assert.match(await yubor(p, url, "include"), /^xato: TypeError/);
    assert.match(await yubor(p, url, "omit"), /^200/);
    await ctx.close();
    yomon.close();
  });

  test("HSTS faqat hsts: true bo'lganda: max-age=31536000; includeSubDomains", async () => {
    const r = await request(await expressIlova({ ombor: new XotiraOmbori(), hsts: true })).get("/v1/vazifalar").expect(200);
    assert.equal(r.headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
  });
}
