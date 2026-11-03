// bot.test.ts — #30 (holat 30): CAPTCHA tokenini serverda tekshirish (Turnstile — fetch mock; haqiqiy siteverify faqat rasmiy test kalitlari bilan — tajriba t30),
// honeypot va SMS pumping (kunlik global byudjet).
import { afterAll, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { SITEVERIFY, Turnstile } from "../src/auth/captcha.ts";
import { XotiraCheklagich } from "../src/umumiy/cheklov.ts";
import { authBaza, authBogliqliklari, hisobOch, PAROL, tozala } from "./auth-yordam.ts";

describe("Turnstile (mock fetch)", () => {
  const javob = (j: object) => (() => Promise.resolve(Response.json(j))) as unknown as typeof fetch;
  test("success — ok; error-codes — rad (sabab bilan); hostname mos emas — rad; tarmoq xatosi — rad (yopiq holat); tokensiz — fetch chaqirilmaydi", async () => {
    let chaqiruv: { url: string; tana: string } | undefined;
    const ushla = ((url: string, o: RequestInit) => { chaqiruv = { url, tana: (o.body as URLSearchParams).toString() }; return Promise.resolve(Response.json({ success: true, hostname: "vazifalar.uz" })); }) as unknown as typeof fetch;
    assert.deepEqual(await new Turnstile("sir", { fetchFn: ushla, hostname: "vazifalar.uz" }).tekshir("tok", "203.0.113.5"), { ok: true });
    assert.deepEqual(chaqiruv, { url: SITEVERIFY, tana: "secret=sir&response=tok&remoteip=203.0.113.5" });
    assert.deepEqual(await new Turnstile("s", { fetchFn: javob({ success: false, "error-codes": ["timeout-or-duplicate"] }) }).tekshir("tok", undefined), { ok: false, sabab: "timeout-or-duplicate" });
    assert.deepEqual(await new Turnstile("s", { fetchFn: javob({ success: true, hostname: "example.com" }), hostname: "vazifalar.uz" }).tekshir("tok", undefined), { ok: false, sabab: "hostname" });
    assert.deepEqual(await new Turnstile("s", { fetchFn: () => Promise.reject(new Error("tarmoq")) }).tekshir("tok", undefined), { ok: false, sabab: "siteverify-xato" });
    chaqiruv = undefined;
    assert.deepEqual(await new Turnstile("s", { fetchFn: ushla }).tekshir(undefined, undefined), { ok: false, sabab: "token-yoq" });
    assert.equal(chaqiruv, undefined);
  });
});

const baza = await authBaza("bot");
if (typeof baza === "string") {
  test.skip(`bot himoyasi (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  beforeEach(() => tozala(pool));
  const hodisa = async (usul: string) => (await pool.query("SELECT 1 FROM auth_hodisalar WHERE tur = 'bot_tutildi' AND tafsilot->>'usul' = $1", [usul])).rowCount;

  test("CAPTCHA yoqilgan: X-Captcha'siz yoki noto'g'ri — 400 captcha (hisob yaratilmaydi); to'g'ri — 202; login — CAPTCHA'siz", async () => {
    const d = { ...authBogliqliklari(pool), captcha: { tekshir: (t: string | undefined) => Promise.resolve(t === "yaxshi" ? { ok: true } : { ok: false, sabab: "rad" }) } };
    const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d });
    const tana = { email: "aziz@example.com", toliqIsm: "Aziz", parol: PAROL };
    const r = await request(app).post("/v1/auth/royxat").send(tana).expect(400);
    assert.equal((r.body as { kod: string }).kod, "captcha");
    await request(app).post("/v1/auth/royxat").set("X-Captcha", "yomon").send(tana).expect(400);
    assert.equal((await pool.query("SELECT 1 FROM foydalanuvchilar")).rowCount, 0);
    await request(app).post("/v1/auth/royxat").set("X-Captcha", "yaxshi").send(tana).expect(202);
    await request(app).post("/v1/auth/parol-tiklash/sorov").send({ email: "aziz@example.com" }).expect(400);
    await request(app).post("/v1/auth/otp/yubor").send({ telefon: "+998900000000" }).expect(400);
    await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL }).expect(403); // CAPTCHA'siz o'tdi (email tasdiqlanmagan — 403)
    assert.equal(await hodisa("captcha"), 4); // 2 ro'yxat + tiklash + SMS
  });

  test("honeypot: yashirin vebSayt maydoni to'ldirilgan — o'sha 202, lekin hisob ham, xat ham yo'q", async () => {
    const d = authBogliqliklari(pool);
    const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d });
    const a = await request(app).post("/v1/auth/royxat").send({ email: "bot@example.com", toliqIsm: "Bot", parol: PAROL, vebSayt: "https://spam.example" }).expect(202);
    const b = await request(app).post("/v1/auth/royxat").send({ email: "odam@example.com", toliqIsm: "Odam", parol: PAROL, vebSayt: "" }).expect(202);
    assert.deepEqual(a.body, b.body);
    await d.fon.tugashi();
    assert.deepEqual((await pool.query<{ email: string }>("SELECT email FROM foydalanuvchilar")).rows, [{ email: "odam@example.com" }]);
    assert.deepEqual(d.pochtachi.yuborilgan.map((x) => x.kimga), ["odam@example.com"]);
    assert.equal(await hodisa("honeypot"), 1);
  });

  test("SMS pumping: kunlik global byudjet (testda 1) — ikkinchi foydalanuvchiga SMS ketmaydi, jurnalda kunlik-byudjet", async () => {
    const d = { ...authBogliqliklari(pool), cheklagich: new XotiraCheklagich(), smsKunlikMaks: 1 };
    const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d });
    const a = await hisobOch(app, d, "aziz@example.com");
    const b = await hisobOch(app, d, "dilnoza@example.com");
    await request(app).post("/v1/auth/telefon").set("Cookie", a).send({ telefon: "+998900000001" }).expect(202);
    await request(app).post("/v1/auth/telefon").set("Cookie", b).send({ telefon: "+998900000002" }).expect(202);
    await d.fon.tugashi();
    assert.deepEqual(d.sms.yuborilgan.map((x) => x.telefon), ["+998900000001"]);
    assert.equal((await pool.query("SELECT 1 FROM auth_hodisalar WHERE tafsilot->>'cheklov' = 'kunlik-byudjet'")).rowCount, 1);
  });
}
