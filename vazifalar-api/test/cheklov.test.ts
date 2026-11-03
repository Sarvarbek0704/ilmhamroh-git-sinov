// cheklov.test.ts — #26 (holat 26): tezlik cheklovi — fixed window (xotira va Postgres), atomiklik (parallel), login brute force (hisob+IP), muvaffaqiyatda tozalash,
// X-Forwarded-For soxtalashtirish (trust proxy), 2FA urinishlari, RateLimit sarlavhalari, baza xatosida fail-open.
import { afterAll, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { PgCheklagich, XotiraCheklagich } from "../src/umumiy/cheklov.ts";
import type { Cheklagich } from "../src/umumiy/cheklov.ts";
import { hotp, qadam } from "../src/auth/totp.ts";
import { Turnstile } from "../src/auth/captcha.ts";
import { authBaza, authBogliqliklari, cookieniOl, hisobOch, PAROL, tozala } from "./auth-yordam.ts";

test("XotiraCheklagich: oyna ichida limit, oyna tugagach — noldan; tozala", async () => {
  let hozir = 1_000_000;
  const c = new XotiraCheklagich(() => hozir);
  const n = [];
  for (let i = 0; i < 4; i++) n.push(await c.ol("k", 3, 60_000));
  assert.deepEqual(n.map((x) => [x.ruxsat, x.qoldi]), [[true, 2], [true, 1], [true, 0], [false, 0]]);
  assert.equal(n[3]?.tiklanishS, 60);
  hozir += 60_000;
  assert.equal((await c.ol("k", 3, 60_000)).son, 1);
  await c.ol("k", 3, 60_000);
  await c.tozala("k");
  assert.equal((await c.ol("k", 3, 60_000)).son, 1);
});

const baza = await authBaza("cheklov");
if (typeof baza === "string") {
  test.skip(`cheklov (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  const pg = new PgCheklagich(pool);
  beforeEach(() => tozala(pool));

  test("PgCheklagich: 50 parallel so'rov, limit 10 — AYNAN 10 ta ruxsat (UPSERT atomik)", async () => {
    const n = await Promise.all(Array.from({ length: 50 }, () => pg.ol("parallel", 10, 60_000)));
    assert.equal(n.filter((x) => x.ruxsat).length, 10);
    assert.deepEqual([...new Set(n.map((x) => x.son))].length, 50);
  });

  describe("API", () => {
    const ilova = async (c: Cheklagich, trustProxy: boolean | number = false) => {
      const d = { ...authBogliqliklari(pool), cheklagich: c };
      return { d, app: await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, trustProxy }) };
    };
    const xato = (app: Parameters<typeof request>[0], xff?: string) => {
      const r = request(app).post("/v1/auth/kirish");
      return (xff === undefined ? r : r.set("X-Forwarded-For", xff)).send({ email: "aziz@example.com", parol: "notogri-parol-12345" });
    };

    test("brute force: bitta hisob+IP — 5 ta noto'g'ri, 6-chisi 429 + Retry-After + RateLimit; TO'G'RI parol ham 429 (oyna ichida); boshqa hisob — ochiq", async () => {
      const { d, app } = await ilova(pg);
      await hisobOch(app, d, "aziz@example.com");
      await hisobOch(app, d, "dilnoza@example.com");
      for (let i = 0; i < 5; i++) {
        const r = await xato(app).expect(401);
        assert.match(String(r.headers["ratelimit"]), /^limit=\d+, remaining=\d+, reset=\d+$/);
      }
      const r = await xato(app).expect(429);
      assert.equal((r.body as { kod: string }).kod, "tezlik-cheklovi");
      assert.ok(Number(r.headers["retry-after"]) > 800);
      assert.equal(r.headers["ratelimit-policy"], "5;w=900");
      await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL }).expect(429);
      await request(app).post("/v1/auth/kirish").send({ email: "dilnoza@example.com", parol: PAROL }).expect(200);
    });

    test("muvaffaqiyatli kirish hisob+IP hisobini tozalaydi; X-Forwarded-For soxtasi trust proxy'siz yordam bermaydi, trust proxy bilan — bypass (faqat proxy orqasida yoqing!)", async () => {
      const { d, app } = await ilova(pg);
      await hisobOch(app, d, "aziz@example.com");
      for (let i = 0; i < 4; i++) await xato(app).expect(401);
      await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL }).expect(200);
      for (let i = 0; i < 5; i++) await xato(app).expect(401); // tozalangan — yana 5 ta
      await xato(app, "198.51.100.7").expect(429); // trustProxy false — req.ip soket manzili, XFF e'tiborsiz
      const p = (await ilova(new XotiraCheklagich(), true)).app;
      for (let i = 0; i < 6; i++) await xato(p, `198.51.100.${String(i)}`).expect(401); // har so'rov "boshqa IP" — hisob+IP kaliti har xil
    });

    test("2FA: bitta hisobga 5 urinish/15 daqiqa — 6-chi to'g'ri kod ham 429", async () => {
      const { d, app } = await ilova(pg);
      const c = await hisobOch(app, d, "aziz@example.com");
      const s = await request(app).post("/v1/auth/2fa/sozlash").set("Cookie", c).expect(200);
      const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      let bits = 0, q = 0;
      const b: number[] = [];
      for (const ch of (s.body as { siri: string }).siri) { q = (q << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { b.push((q >>> (bits - 8)) & 255); bits -= 8; q &= (1 << bits) - 1; } }
      const siri = Buffer.from(b);
      await request(app).post("/v1/auth/2fa/yoqish").set("Cookie", c).send({ kod: hotp(siri, qadam()) }).expect(200);
      await pool.query("UPDATE mfa_totp SET oxirgi_qadam = 0");
      const mfa = cookieniOl((await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL }).expect(200)).headers["set-cookie"], "__Host-mfa");
      for (let i = 0; i < 5; i++) await request(app).post("/v1/auth/2fa/tekshir").set("Cookie", mfa).send({ kod: "000000" === hotp(siri, qadam()) ? "111111" : "000000" }).expect(401);
      await request(app).post("/v1/auth/2fa/tekshir").set("Cookie", mfa).send({ kod: hotp(siri, qadam()) }).expect(429);
    });

    test("ma'lumot yo'llari: foydalanuvchi bo'yicha (600/daqiqa — testda kichik limit bilan emas, sarlavha tekshiruvi); cheklagich xatosi — fail open + jurnal", async () => {
      const { d, app } = await ilova(pg);
      const c = await hisobOch(app, d, "aziz@example.com");
      const r = await request(app).get("/v1/vazifalar").set("Cookie", c).expect(200);
      assert.equal(r.headers["ratelimit-policy"], "600;w=60");
      const buzuq: Cheklagich = { ol: () => Promise.reject(new Error("baza yo'q")), tozala: () => Promise.resolve() };
      const b = (await ilova(buzuq)).app;
      await request(b).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL }).expect(200);
      await new Promise((ok) => setTimeout(ok, 50));
      assert.ok((await pool.query("SELECT 1 FROM auth_hodisalar WHERE tur = 'cheklov_xato'")).rowCount);
    });

    // 30 B BACKLOG 1 (lockout DoS): 28 da kirish-email (50/kun) oshsa — 24 soat 429: hujumchi istalgan odamning emailini 50 marta xato kiritib, EGASINI
    // bir kunga hisobidan chiqarib qo'yardi. Endi limitdan keyin — CAPTCHA (Cloudflare Turnstile). Turnstile siteverify — soxta fetch, lekin RASMIY test
    // kalitlari semantikasi bilan (developers.cloudflare.com/turnstile/troubleshooting/testing): 1x…AA siri — har token o'tadi, 2x…AA — hech biri
    const TEST_SIRLAR: Record<string, boolean> = { "1x0000000000000000000000000000000AA": true, "2x0000000000000000000000000000000AA": false };
    const siteverify: typeof fetch = (_url, init) => {
      const t = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams();
      const ok = TEST_SIRLAR[t.get("secret") ?? ""] === true && (t.get("response") ?? "") !== "";
      return Promise.resolve(Response.json(ok ? { success: true, hostname: "example.com" } : { success: false, "error-codes": ["invalid-input-response"] }));
    };

    test("BACKLOG 1: kirish-email limiti (50/kun) oshgach — bloklash (429) EMAS, CAPTCHA: tokensiz 400 captcha-kerak, to'g'ri token + parol — 200", async () => {
      const { d, app } = await ilova(new XotiraCheklagich(), true);
      await hisobOch(app, d, "aziz@example.com"); // ro'yxat ham CAPTCHA talab qiladi (#30) — hisob CAPTCHA yoqilishidan oldin
      d.captcha = new Turnstile("1x0000000000000000000000000000000AA", { fetchFn: siteverify });
      // hujumchi: 50 ta IP'dan bittadan (IP va hisob+IP limitlari oshmaydi)
      for (let i = 0; i < 50; i++) await xato(app, `203.0.113.${String(i)}`).expect(401);
      const kir = () => request(app).post("/v1/auth/kirish").set("X-Forwarded-For", "198.51.100.1").send({ email: "aziz@example.com", parol: PAROL });
      const r = await kir().expect(400);
      assert.equal((r.body as { kod: string }).kod, "captcha-kerak");
      await kir().set("X-Captcha", "").expect(400);
      await kir().set("X-Captcha", "XXXX.DUMMY.TOKEN.XXXX").expect(200);
      // hujumchi ham CAPTCHA'siz davom eta olmaydi (bot uchun har urinish — CAPTCHA)
      await xato(app, "203.0.113.200").expect(400);
      // CAPTCHA rad etsa (2x… siri — "har doim xato") — 400
      d.captcha = new Turnstile("2x0000000000000000000000000000000AA", { fetchFn: siteverify });
      await kir().set("X-Captcha", "XXXX.DUMMY.TOKEN.XXXX").expect(400);
    });

    test("BACKLOG 1: CAPTCHA sozlanmagan bo'lsa — avvalgidek 429 (fail closed: bloklash DoS'dan yomonroq — parol tanlash)", async () => {
      const { d, app } = await ilova(new XotiraCheklagich(), true);
      await hisobOch(app, d, "aziz@example.com");
      for (let i = 0; i < 50; i++) await xato(app, `203.0.113.${String(i)}`).expect(401);
      await request(app).post("/v1/auth/kirish").set("X-Forwarded-For", "198.51.100.1").send({ email: "aziz@example.com", parol: PAROL }).expect(429);
    });
  });
}
