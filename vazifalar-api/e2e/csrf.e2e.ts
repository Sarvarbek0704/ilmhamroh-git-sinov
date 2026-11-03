// csrf.e2e.ts — #10 B-114 (holat 10): CSRF haqiqiy brauzerda. Qurbon API'ga kirgan (cookie brauzerda), keyin hujumchi sahifasini ochadi.
// Hujumchi sayti: (a) BIR SAYT, boshqa origin — http://localhost:<boshqa port> (SameSite himoya QILMAYDI — t06), (b) boshqa sayt — http://127.0.0.1:<port>.
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import type { Browser, BrowserContext } from "playwright";
import { authBaza, PAROL, tozala } from "../test/auth-yordam.ts";
import { api, brauzer, sahifaServer } from "./yordam.ts";

const baza = await authBaza("e2e_csrf");

if (typeof baza === "string") {
  test.skip(`CSRF e2e — ${baza}`, () => {});
} else {
  const pool = baza;
  let b: Browser;
  let a: Awaited<ReturnType<typeof api>>;
  let ctx: BrowserContext;
  beforeAll(async () => {
    b = await brauzer();
    a = await api(pool);
  });
  afterAll(async () => {
    await b.close();
    await a.yop();
    await pool.end();
  });
  beforeEach(async () => {
    await tozala(pool);
    ctx = await b.newContext();
    // Qurbon kiradi: context.request cookie'ni brauzer konteksti bilan ulashadi
    assert.equal((await ctx.request.post(`${a.asos}/v1/auth/royxat`, { data: { email: "aziz@example.com", toliqIsm: "Aziz", parol: PAROL } })).status(), 202);
    const r = await ctx.request.post(`${a.asos}/v1/auth/email-tasdiq`, { data: { token: await a.xat() } });
    assert.equal(r.status(), 200);
  });

  /** hujum sahifasi forma bilan avtomatik POST qiladi va natija iframe'ga tushadi */
  async function formaHujumi(host: string, yol: string): Promise<void> {
    const h = await sahifaServer(() => `<!doctype html><body><iframe name="n"></iframe>
      <form id="f" method="post" action="${a.asos}${yol}" target="n"></form>
      <script>document.getElementById("f").submit()</script></body>`);
    const p = await ctx.newPage();
    await p.goto(`http://${host}:${String(h.port)}/`);
    await p.waitForTimeout(800);
    await p.close();
    h.server.close();
  }
  const sessiyaTirikmi = async () => (await ctx.request.get(`${a.asos}/v1/auth/men`)).status() === 200;

  describe("forma orqali CSRF: POST /v1/auth/chiqish-hammasi (tanasiz — jsonKerak yo'q)", () => {
    test("bir sayt, boshqa origin (localhost:<p>) — cookie YUBORILADI (SameSite=Lax yetmaydi) → Origin tekshiruvi 403, sessiya tirik", async () => {
      await formaHujumi("localhost", "/v1/auth/chiqish-hammasi");
      assert.equal(await sessiyaTirikmi(), true, "hujum sessiyalarni bekor qildi");
      const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM sessiyalar WHERE bekor_vaqti IS NOT NULL");
      assert.equal(rows[0]?.n, 0);
    });
    test("boshqa sayt (127.0.0.1:<p>) — SameSite=Lax cookie'ni yubormaydi → sessiya tirik", async () => {
      await formaHujumi("127.0.0.1", "/v1/auth/chiqish-hammasi");
      assert.equal(await sessiyaTirikmi(), true);
    });
  });

  test("bir saytdan no-cors fetch text/plain bilan vazifa yaratish — 415/403, vazifa yaratilmaydi", async () => {
    const h = await sahifaServer(() => `<!doctype html><script>
      fetch("${a.asos}/v1/vazifalar", { method: "POST", mode: "no-cors", credentials: "include", headers: { "Content-Type": "text/plain" }, body: '{"matn":"CSRF vazifa"}' });
    </script>`);
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${String(h.port)}/`);
    await p.waitForTimeout(800);
    h.server.close();
    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM vazifalar");
    assert.equal(rows[0]?.n, 0);
  });

  test("o'z sahifasidan (bir origin) fetch POST JSON — ishlaydi (201); API'ning o'z HTML sahifasidan esa CSP (#24) fetch'ni to'sadi", async () => {
    const p0 = await ctx.newPage();
    await p0.goto(`${a.asos}/`);
    const toslgan = await p0.evaluate(async () => { try { await fetch("/v1/vazifalar"); return "o'tdi"; } catch (x) { return String(x); } });
    assert.match(toslgan, /TypeError/);
    const p = await ctx.newPage();
    await p.goto(`${a.asos}/frontend.html`);
    const holat = await p.evaluate(async () => (await fetch("/v1/vazifalar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matn: "O'zimniki" }) })).status);
    assert.equal(holat, 201);
  });
}
