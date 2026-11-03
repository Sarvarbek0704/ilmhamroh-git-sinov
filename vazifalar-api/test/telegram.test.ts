// telegram.test.ts — #16 (holat 16): Telegram Login Widget va Mini App initData imzosi — SOXTA bot tokeni bilan o'zimiz imzolagan namunalar
// (hujjatdagi algoritm). Haqiqiy bot va Telegram ma'lumoti ishlatilmagan. Ulash → kirish oqimi Postgres bilan.
import { afterAll, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { initDataImzoTekshir, initDataTekshir, widgetTekshir } from "../src/auth/telegram.ts";
import { authBaza, authBogliqliklari, cookieniOl, hisobOch, tozala } from "./auth-yordam.ts";

// Soxta token: haqiqiy format (bot_id:35 belgi), lekin hech qanday bot emas — har ishga tushishda tasodifiy
const TOKEN = `7000000001:${randomBytes(26).toString("base64url").slice(0, 35)}`;
const hozir = () => Math.floor(Date.now() / 1000);
const satr = (m: Record<string, string>, tashla: string[]) => Object.entries(m).filter(([k]) => !tashla.includes(k)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");

/** Telegram serveri qiladigan ish — Login Widget imzosi */
function widget(m: Record<string, string>, token = TOKEN): Record<string, string> {
  return { ...m, hash: createHmac("sha256", createHash("sha256").update(token).digest()).update(satr(m, [])).digest("hex") };
}
function initData(m: Record<string, string>, token = TOKEN): string {
  const hash = createHmac("sha256", createHmac("sha256", "WebAppData").update(token).digest()).update(satr(m, [])).digest("hex");
  return new URLSearchParams({ ...m, hash }).toString();
}

describe("imzo algoritmlari (bazasiz)", () => {
  const w = () => ({ id: "123456789", first_name: "Aziz", username: "aziz_uz", auth_date: String(hozir()) });

  test("Login Widget: to'g'ri — ok; maydon o'zgartirilsa, boshqa token, eskirgan, kelajakdagi, hash'siz — xato", () => {
    // 29-qism B: w() bir marta — ikki chaqiruv orasida soniya almashsa authDate farq qilardi (holat 35 to'liq yugurishida yiqildi — poyga)
    const m = w();
    const ok = widgetTekshir(widget(m), TOKEN, 86_400);
    assert.deepEqual(ok, { tur: "ok", foydalanuvchi: { id: 123456789, ism: "Aziz", username: "aziz_uz" }, authDate: Number(m.auth_date) });
    assert.equal(widgetTekshir({ ...widget(w()), id: "1" }, TOKEN, 86_400).tur, "xato");
    assert.deepEqual(widgetTekshir(widget(w(), "7000000002:boshqa-token-boshqa-token-boshqa-tok"), TOKEN, 86_400), { tur: "xato", sabab: "imzo" });
    assert.deepEqual(widgetTekshir(widget({ ...w(), auth_date: String(hozir() - 90_000) }), TOKEN, 86_400), { tur: "xato", sabab: "eskirgan" });
    assert.deepEqual(widgetTekshir(widget({ ...w(), auth_date: String(hozir() + 3_600) }), TOKEN, 86_400), { tur: "xato", sabab: "eskirgan" });
    const hashsiz = widget(w());
    delete hashsiz["hash"];
    assert.deepEqual(widgetTekshir(hashsiz, TOKEN, 86_400), { tur: "xato", sabab: "maydon" });
    assert.deepEqual(widgetTekshir({ ...widget(w()), hash: "ZZ" }, TOKEN, 86_400), { tur: "xato", sabab: "imzo" });
  });

  test("Mini App initData: Widget kaliti bilan imzolangani YAROQSIZ (kalit boshqacha hosil qilinadi); user JSON'dan", () => {
    const m = { auth_date: String(hozir()), query_id: "AAHdF6IQAAAAAN0XohDhrOrc", user: JSON.stringify({ id: 42, first_name: "Malika", username: "malika" }) };
    assert.deepEqual(initDataTekshir(initData(m), TOKEN, 86_400), { tur: "ok", foydalanuvchi: { id: 42, ism: "Malika", username: "malika" }, authDate: Number(m.auth_date) });
    const widgetKaliti = new URLSearchParams({ ...m, hash: createHmac("sha256", createHash("sha256").update(TOKEN).digest()).update(satr(m, [])).digest("hex") }).toString();
    assert.deepEqual(initDataTekshir(widgetKaliti, TOKEN, 86_400), { tur: "xato", sabab: "imzo" });
    assert.equal(initDataTekshir(initData({ ...m, user: "{buzuq" }), TOKEN, 86_400).tur, "xato");
  });

  test("third-party (tokensiz) Ed25519 imzo — o'zimiz yaratgan kalit juftligi bilan (Telegram ochiq kaliti — hujjatda)", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const ochiq = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
    const m = { auth_date: String(hozir()), user: JSON.stringify({ id: 42, first_name: "Malika" }) };
    const signature = sign(null, Buffer.from(`7000000001:WebAppData\n${satr(m, [])}`), privateKey).toString("base64url");
    const data = new URLSearchParams({ ...m, hash: "e".repeat(64), signature }).toString();
    assert.equal(initDataImzoTekshir(data, 7000000001, ochiq, 86_400).tur, "ok");
    assert.deepEqual(initDataImzoTekshir(data, 7000000002, ochiq, 86_400), { tur: "xato", sabab: "imzo" }); // boshqa bot
    const boshqa = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
    assert.deepEqual(initDataImzoTekshir(data, 7000000001, boshqa, 86_400), { tur: "xato", sabab: "imzo" });
  });
});

const baza = await authBaza("telegram");
if (typeof baza === "string") {
  test.skip(`Telegram (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  const d = authBogliqliklari(pool);
  d.telegram = { botToken: TOKEN, maksS: 86_400 };
  const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d });
  beforeEach(() => tozala(pool));
  const tg = (id = "123456789") => widget({ id, first_name: "Aziz", auth_date: String(hozir()) });

  test("ulanmagan Telegram — 404; ulash (sessiya bilan) → keyin Telegram bilan kirish → o'sha hisob", async () => {
    await request(app).post("/v1/auth/telegram").send(tg()).expect(404);
    const c = await hisobOch(app, d, "aziz@example.com");
    await request(app).post("/v1/auth/telegram/ulash").send(tg()).expect(401);
    await request(app).post("/v1/auth/telegram/ulash").set("Cookie", c).send(tg()).expect(204);
    const r = await request(app).post("/v1/auth/telegram").send({ ...tg(), id: 123456789 }).expect(200); // id son ko'rinishida (Telegram JS shunday beradi)
    const men = await request(app).get("/v1/auth/men").set("Cookie", cookieniOl(r.headers["set-cookie"])).expect(200);
    assert.equal((men.body as { foydalanuvchi: { email: string } }).foydalanuvchi.email, "aziz@example.com");
  });

  test("soxta imzo, eskirgan auth_date — 401 telegram-xato; boshqa hisobga ulangan Telegram — 409", async () => {
    const c = await hisobOch(app, d, "aziz@example.com");
    await request(app).post("/v1/auth/telegram/ulash").set("Cookie", c).send(tg()).expect(204);
    const r = await request(app).post("/v1/auth/telegram").send({ ...tg(), first_name: "Hujumchi" }).expect(401);
    assert.equal((r.body as { kod: string }).kod, "telegram-xato");
    await request(app).post("/v1/auth/telegram").send(widget({ id: "123456789", auth_date: String(hozir() - 100_000) })).expect(401);
    const dilnoza = await hisobOch(app, d, "dilnoza@example.com");
    await request(app).post("/v1/auth/telegram/ulash").set("Cookie", dilnoza).send(tg()).expect(409);
  });
}
