// webhook-api.test.ts — 29-qism B (holat 35): foydalanuvchi webhook obunalari (CRUD, sir bir marta), vazifa hodisalari → yetkazish qatorlari (206),
// holat 50 dan: hodisa outbox'dan (relay → hodisaIshlovchisi, navbatsiz); ishchi (vazifalar_ishchi roli) yuboradi — Standard Webhooks imzosi qabul qiluvchida tekshiriladi. Auth test bazasi kerak; bo'lmasa SKIP.
import { afterAll, beforeAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori, pgPool } from "../src/vazifalar/pg-ombor.ts";
import { relay } from "../src/navbat/outbox.ts";
import { hodisaIshlovchisi } from "../src/navbat/tarqatish.ts";
import { yetkazishIshi } from "../src/webhook/chiquvchi.ts";
import { tekshir as imzoTekshir } from "../src/webhook/imzo.ts";
import { xavfsizAgent } from "../src/webhook/ssrf.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";

const baza = await authBaza("webhook_api");
if (typeof baza === "string") {
  test.skip(`webhook obunalari (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  const ishchi = pgPool(Object.assign(new URL(pool.options.connectionString ?? ""), { username: "vazifalar_ishchi" }).toString(), { max: 3 });
  const kelgan: { h: Record<string, string | string[] | undefined>; tana: string }[] = [];
  const srv = createServer((req, res) => {
    let t = "";
    req.on("data", (c: Buffer) => { t += c.toString(); }).on("end", () => { kelgan.push({ h: req.headers, tana: t }); res.writeHead(204).end(); });
  });
  const agent = xavfsizAgent({ ruxsat: (ip) => ip === "127.0.0.1" || ip === "::1" });
  let manzil = "";
  beforeAll(async () => { srv.listen(0, "127.0.0.1"); await once(srv, "listening"); manzil = `http://localhost:${String((srv.address() as AddressInfo).port)}/hook`; });
  afterAll(async () => { srv.close(); await agent.close(); await ishchi.end(); await pool.end(); });
  beforeEach(() => tozala(pool));
  const ilova = async () => {
    const d = authBogliqliklari(pool);
    return { d, app: await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, webhooklar: { pool, httpRuxsat: true } }) };
  };
  const navbatda = async (n: number) => {
    for (let i = 0; i < 80; i++) {
      if (((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM webhook_yetkazishlar")).rows[0]?.n ?? 0) >= n) return;
      await new Promise((ok) => setTimeout(ok, 25));
    }
    assert.fail(`${String(n)} ta yetkazish qatori kutildi`);
  };

  test("obuna → vazifa hodisalari (4 tur) → ishchi yuboradi, imzo to'g'ri; begona vazifa hodisasi bu obunaga tushmaydi", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const dil = await hisobOch(app, d, "dilnoza@example.com");
    const o = (await request(app).post("/v1/webhooklar").set("Cookie", aziz).send({ url: manzil }).expect(201)).body as { id: number; sir: string; hodisalar: string[] };
    assert.match(o.sir, /^whsec_/);
    assert.equal(o.hodisalar.length, 4);
    const l = (await request(app).get("/v1/webhooklar").set("Cookie", aziz).expect(200)).body as { webhooklar: Record<string, unknown>[] };
    assert.equal(l.webhooklar.length, 1);
    assert.equal("sir" in (l.webhooklar[0] ?? {}), false); // sir qayta ko'rsatilmaydi

    const v = (await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Non olish" }).expect(201)).body as { id: number };
    await request(app).patch(`/v1/vazifalar/${String(v.id)}`).set("Cookie", aziz).set("Content-Type", "application/merge-patch+json").send({ bajarildi: true }).expect(200);
    await request(app).delete(`/v1/vazifalar/${String(v.id)}`).set("Cookie", aziz).expect(204);
    await request(app).post("/v1/vazifalar").set("Cookie", dil).send({ matn: "Dilnozaniki" }).expect(201);
    const ishla = hodisaIshlovchisi({ ishchi });
    assert.deepEqual(await relay(ishchi, async (h) => { await ishla(h); }), { tarqatildi: 5, xato: 0 }); // Dilnozaniki ham outbox'da, lekin uning obunasi yo'q
    await navbatda(4);
    assert.deepEqual(await yetkazishIshi(ishchi, { agent, httpRuxsat: true, portlar: "hammasi", tasodif: () => 0.5 }), { yuborildi: 4, qayta: 0, tashlandi: 0 });
    const turlar = kelgan.map((k) => (JSON.parse(k.tana) as { type: string }).type).sort();
    assert.deepEqual(turlar, ["vazifa.bajarildi", "vazifa.ochirildi", "vazifa.yangilandi", "vazifa.yaratildi"]);
    for (const k of kelgan) assert.equal(imzoTekshir(o.sir, (n) => k.h[n] as string | undefined, k.tana).ok, true);
    const y = (await request(app).get(`/v1/webhooklar/${String(o.id)}/yetkazishlar`).set("Cookie", aziz).expect(200)).body as { yetkazishlar: { holat: string }[] };
    assert.deepEqual([...new Set(y.yetkazishlar.map((x) => x.holat))], ["yuborildi"]);
  });

  test("xavfsizlik: begona obuna 404; ichki manzil URL — 422; 5 tadan ortiq — 409; kontekstsiz funksiya — 0 qator", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const dil = await hisobOch(app, d, "dilnoza@example.com");
    const o = (await request(app).post("/v1/webhooklar").set("Cookie", aziz).send({ url: manzil, hodisalar: ["vazifa.bajarildi"] }).expect(201)).body as { id: number };
    await request(app).delete(`/v1/webhooklar/${String(o.id)}`).set("Cookie", dil).expect(404);
    await request(app).get(`/v1/webhooklar/${String(o.id)}/yetkazishlar`).set("Cookie", dil).expect(404);
    assert.equal(((await request(app).get("/v1/webhooklar").set("Cookie", dil).expect(200)).body as { webhooklar: unknown[] }).webhooklar.length, 0);
    await request(app).post("/v1/webhooklar").set("Cookie", aziz).send({ url: "http://169.254.169.254/latest" }).expect(422);
    await request(app).post("/v1/webhooklar").set("Cookie", aziz).send({ url: "https://u:p@hook.example.uz/" }).expect(422);
    await request(app).post("/v1/webhooklar").set("Cookie", aziz).send({ url: manzil, hodisalar: ["vazifa.boshqa"] }).expect(422);
    for (let i = 0; i < 4; i++) await request(app).post("/v1/webhooklar").set("Cookie", aziz).send({ url: manzil }).expect(201);
    await request(app).post("/v1/webhooklar").set("Cookie", aziz).send({ url: manzil }).expect(409);
    // RLS konteksti yo'q (set_config qilinmagan) — funksiya hech kimning obunasiga yozmaydi
    assert.equal((await ishchi.query<{ n: number }>("SELECT webhook_hodisa_qosh('vazifa.bajarildi', 'x-1', '{}') AS n")).rows[0]?.n, 0);
    await request(app).delete(`/v1/webhooklar/${String(o.id)}`).set("Cookie", aziz).expect(204);
  });
}
