// bildirishnoma.test.ts — 29-qism B (holat 18): markaz (ishchi roli, 205) → kanallar: email (Mailpit), push (soxta HTTPS xizmat), SMS (soxta Eskiz + callback);
// API: ro'yxat (keyset), o'qildi, push obunasi — 28 sessiyasi bilan, RLS ostida. Auth test bazasi, Mailpit, KANON_TLS kerak; bo'lmasa SKIP.
import { afterAll, beforeAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Agent } from "node:https";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import request from "supertest";
import express from "express";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori, pgPool } from "../src/vazifalar/pg-ombor.ts";
import { BildirishnomaMarkazi, type YetkazishIshi } from "../src/bildirishnoma/markaz.ts";
import { emailYuboruvchi, pushYuboruvchi, smsYuboruvchi } from "../src/bildirishnoma/yuboruvchilar.ts";
import { Pochta } from "../src/email/pochta.ts";
import { WebPush } from "../src/push/webpush.ts";
import { EskizProvayder } from "../src/sms/sms.ts";
import { ProvayderSms, smsIdOch, smsIdYarat } from "../src/sms/ulash.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";
import { soxtaPush, type SoxtaPush } from "./soxta/push-xizmati.ts";
import { soxtaEskiz, type SoxtaEskiz } from "./soxta/eskiz.ts";

test("SMS callback id: imzoli, boshqa kalit yoki o'zgartirilgan id — rad", () => {
  const k = randomBytes(32);
  const s = smsIdYarat(k, 77);
  assert.equal(smsIdOch(k, s), 77);
  assert.equal(smsIdOch(k, s.replace(/^b77/, "b78")), undefined);
  assert.equal(smsIdOch(randomBytes(32), s), undefined);
  assert.equal(smsIdOch(k, "b77"), undefined);
});

const API = process.env["MAILPIT_API"];
const TLS = process.env["KANON_TLS"];
const baza = await authBaza("bildirishnoma");
if (typeof baza === "string" || API === undefined || TLS === undefined) {
  test.skip(`bildirishnoma markazi (Postgres + Mailpit + push + SMS) — ${typeof baza === "string" ? baza : "MAILPIT_API/KANON_TLS yo'q"}`, () => {});
} else {
  const pool = baza;
  // Fon jarayonlari (worker) — vazifalar_ishchi roli (205: BYPASSRLS, auth jadvallarisiz); API — test pool'i
  const ishchiPool = pgPool(Object.assign(new URL(pool.options.connectionString ?? ""), { username: "vazifalar_ishchi" }).toString(), { max: 3 });
  const pochta = new Pochta({ host: process.env["SMTP_HOST"] ?? "127.0.0.1", port: Number(process.env["SMTP_PORT"] ?? 0), secure: false, from: "Vazifalar <noreply@vazifalar.example.uz>" });
  const vapid = { subject: "mailto:admin@vazifalar.example.uz", ...WebPush.kalitlarYarat() };
  const smsKaliti = randomBytes(32);
  const obunaKaliti = randomBytes(32);
  let push: SoxtaPush;
  let eskiz: SoxtaEskiz;
  beforeAll(async () => { push = await soxtaPush(TLS); eskiz = await soxtaEskiz({ email: "test@example.uz", parol: "soxta-parol", callbackKechikishMs: 10 }); });
  afterAll(async () => { pochta.yop(); await push.yop(); await eskiz.yop(); await ishchiPool.end(); await pool.end(); });
  beforeEach(() => tozala(pool));
  const ilova = async () => {
    const d = authBogliqliklari(pool);
    return { d, app: await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, obunaKaliti, bildirishnoma: { pool, vapidOchiq: vapid.publicKey, smsKaliti } }) };
  };
  const navbat: YetkazishIshi[] = [];
  const markaz = new BildirishnomaMarkazi(ishchiPool, { qosh: (i) => { navbat.push(...i); return Promise.resolve(); } });

  test("API: ro'yxat keyset bilan, o'qilmagan soni, o'qildi; begona — ko'rinmaydi; sessiyasiz — 401", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const dil = await hisobOch(app, d, "dilnoza@example.com");
    const fId = Number((await pool.query<{ id: string }>("SELECT id FROM foydalanuvchilar WHERE email = 'aziz@example.com'")).rows[0]?.id);
    for (const n of [1, 2, 3]) await markaz.bildir(fId, { tur: "vazifa.muddat", sarlavha: `Eslatma ${String(n)}`, matn: "Non olish", havola: "/vazifalar/1", dedupKalit: `t:${String(n)}`, kanallar: [] });
    assert.equal((await markaz.bildir(fId, { tur: "vazifa.muddat", sarlavha: "Takror", matn: "x", dedupKalit: "t:1" })).yangi, false);
    const s1 = (await request(app).get("/v1/bildirishnomalar?limit=2").set("Cookie", aziz).expect(200)).body as { bildirishnomalar: { id: number; sarlavha: string }[]; oqilmagan: number; keyingiKursor: string };
    assert.deepEqual([s1.bildirishnomalar.map((b) => b.sarlavha), s1.oqilmagan], [["Eslatma 3", "Eslatma 2"], 3]);
    const s2 = (await request(app).get(`/v1/bildirishnomalar?limit=2&kursor=${s1.keyingiKursor}`).set("Cookie", aziz).expect(200)).body as { bildirishnomalar: { id: number; sarlavha: string }[]; keyingiKursor: string | null };
    assert.deepEqual([s2.bildirishnomalar.map((b) => b.sarlavha), s2.keyingiKursor], [["Eslatma 1"], null]);
    await request(app).get("/v1/bildirishnomalar?kursor=yomon").set("Cookie", aziz).expect(400); // query xatosi — 400 (28 qoidasi), tana — 422
    const begona = (await request(app).get("/v1/bildirishnomalar").set("Cookie", dil).expect(200)).body as { bildirishnomalar: unknown[]; oqilmagan: number };
    assert.deepEqual([begona.bildirishnomalar.length, begona.oqilmagan], [0, 0]);
    // Dilnoza Azizning id'sini "o'qildi" qila olmaydi
    assert.equal(((await request(app).post("/v1/bildirishnomalar/oqildi").set("Cookie", dil).send({ idlar: s1.bildirishnomalar.map((b) => b.id) }).expect(200)).body as { belgilandi: number }).belgilandi, 0);
    assert.equal(((await request(app).post("/v1/bildirishnomalar/oqildi").set("Cookie", aziz).send({ idlar: [s1.bildirishnomalar[0]?.id] }).expect(200)).body as { belgilandi: number }).belgilandi, 1);
    assert.equal(((await request(app).post("/v1/bildirishnomalar/oqildi").set("Cookie", aziz).send({ hammasi: true }).expect(200)).body as { belgilandi: number }).belgilandi, 2);
    await request(app).get("/v1/bildirishnomalar").expect(401);
  });

  test("kanallar: push obunasi (API) → bildir → email (Mailpit, One-Click) + push (HTTPS) yetkazildi; SMS — faqat yoqilganda, callback holatni yangilaydi", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const dil = await hisobOch(app, d, "dilnoza@example.com");
    const fId = Number((await pool.query<{ id: string }>("SELECT id FROM foydalanuvchilar WHERE email = 'aziz@example.com'")).rows[0]?.id);
    assert.equal(((await request(app).get("/v1/push/kalit").set("Cookie", aziz).expect(200)).body as { kalit: string }).kalit, vapid.publicKey);
    const ob = push.obunaYarat();
    await request(app).post("/v1/push/obuna").set("Cookie", aziz).send(ob).expect(201);
    await request(app).post("/v1/push/obuna").set("Cookie", aziz).send(ob).expect(201); // takror — upsert
    await request(app).post("/v1/push/obuna").set("Cookie", dil).send(ob).expect(422); // begona endpoint
    await request(app).post("/v1/push/obuna").set("Cookie", aziz).send({ ...ob, endpoint: "http://169.254.169.254/x" }).expect(422);
    await pool.query("UPDATE foydalanuvchilar SET telefon = '+998901234567' WHERE id = $1", [fId]);

    navbat.length = 0;
    const b = await markaz.bildir(fId, { tur: "vazifa.muddat", sarlavha: "Muddat yaqin", matn: "Hisobot — 18:00", havola: "/vazifalar/7", dedupKalit: "v7" });
    assert.deepEqual(b.kanallar, ["email", "push"]); // SMS — sukut o'chiq; Telegram ulanmagan
    const wp = new WebPush(vapid, new Agent({ ca: readFileSync(`${TLS}/sert.pem`) }));
    const yub = { email: emailYuboruvchi(pochta, { obunaKaliti, apiUrl: "http://api.test", ilovaUrl: "http://localhost:5173" }), push: pushYuboruvchi(wp) };
    for (const i of navbat) assert.equal(await markaz.yetkaz(i, yub), "yuborildi", JSON.stringify((await pool.query("SELECT kanal, oxirgi_xato FROM yetkazishlar")).rows));
    for (const i of navbat) assert.equal(await markaz.yetkaz(i, yub), "allaqachon"); // idempotent
    assert.deepEqual(push.qabul.at(-1)?.yuk, { sarlavha: "Muddat yaqin", matn: "Hisobot — 18:00", url: "/vazifalar/7", teg: "vazifa.muddat" });
    let xat: { ID: string } | undefined;
    for (let i = 0; i < 200 && xat === undefined; i++) { // to'liq parallel yugurishda (CPU band) 2 s yetmadi — holat 35
      xat = ((await (await fetch(`${API}/api/v1/search?query=${encodeURIComponent("to:aziz@example.com subject:\"Muddat yaqin\"")}`)).json()) as { messages: { ID: string }[] }).messages[0];
      if (xat === undefined) await new Promise((ok) => setTimeout(ok, 50));
    }
    const h = (await (await fetch(`${API}/api/v1/message/${xat?.ID ?? ""}/headers`)).json()) as Record<string, string[]>;
    assert.match(h["List-Unsubscribe"]?.[0] ?? "", /^<http:\/\/api\.test\/v1\/obuna\/\d+\.email\.[A-Za-z0-9_-]{43}>/);
    assert.deepEqual(h["List-Unsubscribe-Post"], ["List-Unsubscribe=One-Click"]);

    // SMS: foydalanuvchi aniq yoqdi → kanal tanlanadi; soxta Eskiz callback'ni API'ga yuboradi (imzoli id) → yetkazishlar yangilanadi
    await pool.query(`UPDATE foydalanuvchilar SET sozlamalar = '{"bildirishnoma":{"sms":true,"email":false,"push":false}}' WHERE id = $1`, [fId]);
    // Callback tugaganini sanaymiz: soxta Eskiz uni ~10 ms da yuboradi — yetkaz() tranzaksiyasi qulfi tufayli u COMMIT'dan keyin darhol bajariladi;
    // "yangilangan_vaqt o'zgarishini kutish" poyga edi (to'liq yugurishda o'zgarish 'oldin' o'qilishidan oldin bo'lib o'tdi — holat 35/45 da 2 marta yiqildi)
    let callbacklar = 0;
    const server = express().use((req, res, next) => { if (req.path === "/v1/sms/callback") res.on("finish", () => { callbacklar++; }); next(); }).use(app).listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const cb = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/v1/sms/callback`;
      navbat.length = 0;
      const s = await markaz.bildir(fId, { tur: "vazifa.muddat", sarlavha: "SMS", matn: "Non olish", dedupKalit: "v8" });
      assert.deepEqual(s.kanallar, ["sms"]);
      const sms = smsYuboruvchi(new EskizProvayder({ baseUrl: eskiz.url, email: "test@example.uz", parol: "soxta-parol", from: "4546", callbackUrl: cb }), smsKaliti);
      assert.equal(await markaz.yetkaz({ bildirishnomaId: s.id, kanal: "sms" }, { sms }), "yuborildi");
      assert.equal(eskiz.yuborilgan.at(-1)?.tel, "998901234567");
      // soxta Eskiz callback'ni (DELIVRD) ~10 ms dan keyin API'ga yuboradi — holat 'yuborildi' qoladi
      for (let i = 0; i < 200 && callbacklar === 0; i++) await new Promise((ok) => setTimeout(ok, 25));
      assert.equal(callbacklar, 1, "callback kelmadi");
      const holat = (await pool.query<{ h: string }>("SELECT holat AS h FROM yetkazishlar WHERE bildirishnoma_id = $1 AND kanal = 'sms'", [s.id])).rows[0]?.h ?? "";
      // imzosiz callback — 404; imzoli UNDELIV — xato
      assert.equal(holat.startsWith("yuborildi"), true);
      await request(app).post(`/v1/sms/callback?id=b${String(s.id)}`).send({ status: "UNDELIV" }).expect(404);
      await request(app).post(`/v1/sms/callback?id=${smsIdYarat(smsKaliti, s.id)}`).send({ status: "UNDELIV" }).expect(200);
      assert.equal((await pool.query<{ h: string }>("SELECT holat || ':' || oxirgi_xato AS h FROM yetkazishlar WHERE bildirishnoma_id = $1 AND kanal = 'sms'", [s.id])).rows[0]?.h, "xato:sms: UNDELIV");
    } finally {
      server.close();
    }
  });

  test("28 OTP SMS'i haqiqiy provayder adapteri orqali (soxta Eskiz)", async () => {
    const p = new ProvayderSms(new EskizProvayder({ baseUrl: eskiz.url, email: "test@example.uz", parol: "soxta-parol", from: "4546" }));
    await p.yubor("+998901112233", "Kod: 123456");
    assert.deepEqual([eskiz.yuborilgan.at(-1)?.tel, eskiz.yuborilgan.at(-1)?.matn], ["998901112233", "Kod: 123456"]);
  });
}
