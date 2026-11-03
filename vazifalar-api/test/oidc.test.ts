// oidc.test.ts — #15 (holat 15): "Google bilan kirish" — LOKAL soxta OIDC provayder (oidc-provider, 127.0.0.1) bilan to'liq oqim (Authorization Code + PKCE).
// Haqiqiy Google ishlatilmaydi. Hisoblarni bog'lash qoidalari, pre-hijacking, email_verified=false, buzilgan/begona holat cookie'si (login CSRF).
import { afterAll, beforeAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import Provider from "oidc-provider";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { Oidc } from "../src/auth/oidc.ts";
import { authBaza, authBogliqliklari, cookieniOl, hisobOch, PAROL, tozala } from "./auth-yordam.ts";

const baza = await authBaza("oidc");

if (typeof baza === "string") {
  test.skip(`OIDC (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  /** Provayderdagi "Google hisobi" — har test o'zgartiradi */
  let hisob: { sub: string; email: string; email_verified: boolean | string; name: string } = { sub: "google-1001", email: "aziz@example.com", email_verified: true, name: "Aziz Google" };
  const d = authBogliqliklari(pool);
  const api = createServer();
  const prov = createServer();
  await Promise.all([new Promise<void>((r) => api.listen(0, "127.0.0.1", r)), new Promise<void>((r) => prov.listen(0, "127.0.0.1", r))]);
  const API = `http://127.0.0.1:${String((api.address() as AddressInfo).port)}`;
  const ISSUER = `http://127.0.0.1:${String((prov.address() as AddressInfo).port)}`;
  const QAYTISH = `${API}/v1/auth/oidc/google/qaytish`;
  const SIR = randomBytes(24).toString("base64url");
  const provider = new Provider(ISSUER, {
    clients: [{ client_id: "vazifalar", client_secret: SIR, redirect_uris: [QAYTISH], response_types: ["code"], grant_types: ["authorization_code"] }],
    findAccount: (_c, id) => ({ accountId: id, claims: () => ({ ...hisob, sub: id }) }),
    claims: { openid: ["sub"], email: ["email", "email_verified"], profile: ["name"] },
    features: { devInteractions: { enabled: false } },
    interactions: { url: (_c, i) => `/interaction/${i.uid}` },
    pkce: { required: () => true },
    cookies: { keys: [randomBytes(32).toString("hex")] },
  });
  prov.on("request", (req, res) => {
    void (async () => {
      const m = /^\/interaction\/[\w-]+$/.exec(req.url ?? "");
      if (m === null) { await provider.callback()(req, res); return; }
      const det = await provider.interactionDetails(req, res);
      if (det.prompt.name === "login") { await provider.interactionFinished(req, res, { login: { accountId: hisob.sub } }, { mergeWithLastSubmission: false }); return; }
      const g = new provider.Grant({ accountId: String(det.session?.accountId), clientId: String(det.params["client_id"]) });
      g.addOIDCScope(String(det.params["scope"]));
      await provider.interactionFinished(req, res, { consent: { grantId: await g.save() } }, { mergeWithLastSubmission: true });
    })();
  });
  d.oidc = new Map([["google", new Oidc({ nom: "google", issuer: ISSUER, clientId: "vazifalar", clientSecret: SIR, qaytishUrl: QAYTISH, httpRuxsat: true }, randomBytes(32), true)]]);
  const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d });
  api.on("request", app);
  afterAll(async () => {
    api.close();
    prov.close();
    await pool.end();
  });
  beforeAll(() => { process.removeAllListeners("warning"); });
  beforeEach(() => tozala(pool));

  /** Brauzer taqlidi: API → provayder (redirectlar, provayder cookie'lari) → API qaytish URL'i. oidcCookie — API bergan holat cookie'si (almashtirish mumkin) */
  async function oqim(oidcCookie?: (asl: string) => string): Promise<{ joy: string; sessiya?: string }> {
    const b = await fetch(`${API}/v1/auth/oidc/google`, { redirect: "manual" });
    assert.equal(b.status, 303);
    const asl = cookieniOl(b.headers.getSetCookie(), "__Host-oidc");
    let url = b.headers.get("location") ?? "";
    const jar = new Map<string, string>();
    for (let i = 0; i < 10 && !url.startsWith(QAYTISH); i++) {
      const r = await fetch(url, { redirect: "manual", headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
      for (const c of r.headers.getSetCookie()) { const kv = c.split(";")[0] ?? ""; const j = kv.indexOf("="); jar.set(kv.slice(0, j), kv.slice(j + 1)); }
      url = new URL(r.headers.get("location") ?? "", url).href;
    }
    const q = await fetch(url, { redirect: "manual", headers: { cookie: oidcCookie === undefined ? asl : oidcCookie(asl) } });
    assert.equal(q.status, 303);
    const sc = q.headers.getSetCookie().find((c) => c.startsWith("__Host-sessiya="));
    return sc === undefined ? { joy: q.headers.get("location") ?? "" } : { joy: q.headers.get("location") ?? "", sessiya: sc.split(";")[0] ?? "" };
  }
  const men = async (c?: string) => (c === undefined ? undefined : ((await request(app).get("/v1/auth/men").set("Cookie", c).expect(200)).body as { foydalanuvchi: { id: number; email: string; toliqIsm: string } }).foydalanuvchi);

  test("yangi foydalanuvchi: hisob yaratiladi (parolsiz, email tasdiqlangan), sessiya, ILOVA_URL ga 303; keyingi kirish — o'sha hisob (email o'zgarsa ham, sub bo'yicha)", async () => {
    hisob = { sub: "google-1001", email: "Aziz@Example.com", email_verified: true, name: "Aziz Google" };
    const n = await oqim();
    assert.equal(n.joy, "http://localhost:5173/");
    assert.deepEqual(await men(n.sessiya), { id: 1, email: "aziz@example.com", toliqIsm: "Aziz Google", rol: "foydalanuvchi" });
    const { rows } = await pool.query<{ p: string | null; t: boolean }>("SELECT parol_hash AS p, email_tasdiqlangan_vaqt IS NOT NULL AS t FROM foydalanuvchilar");
    assert.deepEqual(rows, [{ p: null, t: true }]);
    hisob = { ...hisob, email: "yangi.manzil@example.com" };
    assert.equal((await men((await oqim()).sessiya))?.id, 1);
    assert.equal((await pool.query("SELECT 1 FROM foydalanuvchilar")).rowCount, 1);
  });

  test("mavjud TASDIQLANGAN hisob (shu email) — bog'lanadi, paroli saqlanadi", async () => {
    await hisobOch(app, d, "aziz@example.com", "Aziz Karimov");
    hisob = { sub: "google-2002", email: "aziz@example.com", email_verified: true, name: "Aziz G" };
    assert.equal((await men((await oqim()).sessiya))?.id, 1);
    await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL }).expect(200);
  });

  test("PRE-HIJACKING: hujumchi oldindan ochgan TASDIQLANMAGAN hisob — Google bilan kirgach hujumchi paroli o'chadi, sessiyalari bekor", async () => {
    await request(app).post("/v1/auth/royxat").send({ email: "qurbon@example.com", toliqIsm: "Soxta Ism", parol: "Hujumchining-maxfiy-paroli" }).expect(202);
    hisob = { sub: "google-3003", email: "qurbon@example.com", email_verified: true, name: "Qurbon" };
    const n = await oqim();
    assert.equal((await men(n.sessiya))?.email, "qurbon@example.com");
    // email endi tasdiqlangan — lekin hujumchi paroli bilan kira olmaydi
    await request(app).post("/v1/auth/kirish").send({ email: "qurbon@example.com", parol: "Hujumchining-maxfiy-paroli" }).expect(401);
    const { rows } = await pool.query<{ t: string }>("SELECT tafsilot->>'tozalandi' AS t FROM auth_hodisalar WHERE tur = 'tashqi_boglandi'");
    assert.equal(rows[0]?.t, "true");
  });

  test("email_verified=false — rad (xato kodi bilan frontend'ga), hisob yaratilmaydi, mavjudga ham bog'lanmaydi", async () => {
    await hisobOch(app, d, "aziz@example.com");
    hisob = { sub: "google-4004", email: "aziz@example.com", email_verified: false, name: "X" };
    const n = await oqim();
    assert.equal(n.joy, "http://localhost:5173/kirish?xato=tashqi-email-tasdiqlanmagan");
    assert.equal(n.sessiya, undefined);
    assert.equal((await pool.query("SELECT 1 FROM tashqi_hisoblar")).rowCount, 0);
  });

  // 30 B BACKLOG 3: email_verified satr ko'rinishida
  test("email_verified=\"true\" (satr) — tasdiqlangan deb bog'lanadi; \"false\" (satr) — rad", async () => {
    await hisobOch(app, d, "aziz@example.com", "Aziz Karimov");
    hisob = { sub: "google-6006", email: "aziz@example.com", email_verified: "false", name: "Aziz G" };
    const rad = await oqim();
    assert.equal(rad.joy, "http://localhost:5173/kirish?xato=tashqi-email-tasdiqlanmagan");
    assert.equal(rad.sessiya, undefined);
    hisob = { sub: "google-6006", email: "aziz@example.com", email_verified: "true", name: "Aziz G" };
    assert.equal((await men((await oqim()).sessiya))?.id, 1);
    assert.equal((await pool.query("SELECT 1 FROM tashqi_hisoblar WHERE subyekt = 'google-6006'")).rowCount, 1);
  });

  test("holat cookie'si: yo'q, imzosi buzilgan yoki BOSHQA brauzerniki (login CSRF) — oidc-xato, sessiya yo'q", async () => {
    hisob = { sub: "google-5005", email: "aziz@example.com", email_verified: true, name: "A" };
    for (const almashtir of [() => "", (a: string) => `${a.slice(0, -3)}AAA`]) {
      const n = await oqim(almashtir);
      assert.equal(n.joy, "http://localhost:5173/kirish?xato=oidc-xato");
      assert.equal(n.sessiya, undefined);
    }
    // boshqa (hujumchining) oqimi cookie'si bilan — state mos kelmaydi
    const begona = cookieniOl((await fetch(`${API}/v1/auth/oidc/google`, { redirect: "manual" })).headers.getSetCookie(), "__Host-oidc");
    const n = await oqim(() => begona);
    assert.equal(n.joy, "http://localhost:5173/kirish?xato=oidc-xato");
  });

  test("noma'lum provayder — 404; holat cookie: __Host-, HttpOnly, SameSite=Lax, 10 daqiqa", async () => {
    await request(app).get("/v1/auth/oidc/facebook").expect(404);
    const r = await request(app).get("/v1/auth/oidc/google").expect(303);
    const c = (r.headers["set-cookie"] as unknown as string[]).find((x) => x.startsWith("__Host-oidc=")) ?? "";
    assert.match(c, /^__Host-oidc=[\w-]+\.[\w-]+; Max-Age=600; Path=\/; Expires=[^;]+; HttpOnly; Secure; SameSite=Lax$/);
    const u = new URL(String(r.headers.location));
    assert.deepEqual([u.searchParams.get("code_challenge_method"), u.searchParams.get("redirect_uri"), u.searchParams.get("response_type"), u.searchParams.get("scope")],
      ["S256", QAYTISH, "code", "openid email profile"]);
  });
}
