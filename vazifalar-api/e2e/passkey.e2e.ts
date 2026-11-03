// passkey.e2e.ts — #19 (holat 19): passkey (WebAuthn) HAQIQIY brauzerda — Playwright Chromium + CDP virtual autentifikator (ctap2, internal, resident key,
// user verification). Sahifa API bilan BIR origin'da (http://localhost:<port>) — @simplewebauthn/browser UMD bundle'i shu server orqali beriladi.
import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import express from "express";
import type { Browser, Page } from "playwright";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { authBaza, authBogliqliklari, hisobOch, PAROL, tozala } from "../test/auth-yordam.ts";
import { brauzer } from "./yordam.ts";

const baza = await authBaza("e2e_passkey");
if (typeof baza === "string") {
  test.skip(`passkey e2e — ${baza}`, () => {});
} else {
  const pool = baza;
  const d = authBogliqliklari(pool);
  // UMD bundle "exports" da yo'q — paket papkasidan (resolve → script/index.js → ../dist/bundle)
  const bundle = readFileSync(join(dirname(createRequire(import.meta.url).resolve("@simplewebauthn/browser")), "..", "dist", "bundle", "index.umd.min.js"));
  const tashqi = express();
  tashqi.get("/vendor/webauthn.js", (_q, r) => { r.type("js").send(bundle); });
  tashqi.get("/passkey.html", (_q, r) => { r.type("html").send(`<!doctype html><meta charset="utf-8"><script src="/vendor/webauthn.js"></script><p>passkey sinovi</p>`); });
  tashqi.use(await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d }));
  const server = createServer(tashqi);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const ASOS = `http://localhost:${String((server.address() as AddressInfo).port)}`;
  d.mfa.originlar = [ASOS];
  let b: Browser;
  beforeAll(async () => { b = await brauzer(); await tozala(pool); });
  afterAll(async () => { await b.close(); server.close(); await pool.end(); });

  /** Sahifa ichida: boshla → brauzer WebAuthn (virtual autentifikator) → yakun; HTTP holati qaytadi */
  const royxat = (p: Page) => p.evaluate(async () => {
    const o = await (await fetch("/v1/auth/passkey/royxat/boshla", { method: "POST" })).json() as object;
    const w = (globalThis as unknown as { SimpleWebAuthnBrowser: { startRegistration: (x: object) => Promise<object> } }).SimpleWebAuthnBrowser;
    const javob = await w.startRegistration({ optionsJSON: o });
    return (await fetch("/v1/auth/passkey/royxat/yakun", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ javob, nom: "Virtual kalit" }) })).status;
  });
  const kirParol = (p: Page, email: string) => p.evaluate(async ([e, parol]) =>
    (await fetch("/v1/auth/kirish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, parol }) })).status, [email, PAROL] as const);
  const kirish = (p: Page, qaytaYubor = false) => p.evaluate(async (qayta) => {
    const o = await (await fetch("/v1/auth/passkey/kirish/boshla", { method: "POST" })).json() as object;
    const w = (globalThis as unknown as { SimpleWebAuthnBrowser: { startAuthentication: (x: object) => Promise<object> } }).SimpleWebAuthnBrowser;
    const javob = await w.startAuthentication({ optionsJSON: o });
    const yubor = () => fetch("/v1/auth/passkey/kirish/yakun", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ javob }) });
    const birinchi = (await yubor()).status;
    return qayta ? [birinchi, (await yubor()).status] : [birinchi];
  }, qaytaYubor);

  test("ro'yxatdan o'tkazish (sessiya bilan) → chiqish → passkey bilan kirish (parolsiz, emailsiz) → sessiya; o'sha javobni qayta yuborish — 401", async () => {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    await p.goto(`${ASOS}/passkey.html`);
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
    // hisob (ro'yxat + email tasdiq) — supertest bilan; keyin sahifa ichida parol bilan kirish — cookie brauzerda
    await hisobOch(tashqi, d, "aziz@example.com");
    assert.equal(await kirParol(p, "aziz@example.com"), 200);
    assert.equal(await royxat(p), 201);
    const { rows } = await pool.query<{ n: string; h: number }>("SELECT nom AS n, octet_length(ochiq_kalit) AS h FROM passkeylar");
    assert.equal(rows[0]?.n, "Virtual kalit");
    assert.equal(await p.evaluate(async () => (await fetch("/v1/auth/chiqish", { method: "POST" })).status), 204);
    assert.equal(await p.evaluate(async () => (await fetch("/v1/auth/men")).status), 401);
    assert.deepEqual(await kirish(p, true), [200, 401]); // challenge bir marta
    const men = await p.evaluate(async () => (await (await fetch("/v1/auth/men")).json()) as { foydalanuvchi: { email: string } });
    assert.equal(men.foydalanuvchi.email, "aziz@example.com");
    const { rows: h } = await pool.query<{ n: string }>("SELECT hisoblagich::text AS n FROM passkeylar");
    assert.ok(Number(h[0]?.n) >= 1, `hisoblagich ${String(h[0]?.n)}`);
    await ctx.close();
  });

  test("boshqa origin kutilsa (RP sozlamasi noto'g'ri yoki fishing sahifasi) — ro'yxat 400", async () => {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    await p.goto(`${ASOS}/passkey.html`);
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
    await hisobOch(tashqi, d, "dilnoza@example.com");
    assert.equal(await kirParol(p, "dilnoza@example.com"), 200);
    d.mfa.originlar = ["https://vazifalar.example"];
    try {
      assert.equal(await royxat(p), 400);
    } finally {
      d.mfa.originlar = [ASOS];
      await ctx.close();
    }
  });
}
