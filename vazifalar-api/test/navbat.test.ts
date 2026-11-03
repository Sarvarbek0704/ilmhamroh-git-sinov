// navbat.test.ts — 29-qism B (holat 45–48): BullMQ (node-redis klienti orqali) haqiqiy Redis bilan — muddat → eslatma (delayed) → bildirishnoma →
// yetkazish → email (Mailpit); bajarildi → eslatma bekor; qolib ketgan yetkazish qayta navbatga; Bull Board faqat admin. Auth bazasi, Redis, Mailpit kerak.
import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori, pgPool } from "../src/vazifalar/pg-ombor.ts";
import { BildirishnomaMarkazi } from "../src/bildirishnoma/markaz.ts";
import { emailYuboruvchi } from "../src/bildirishnoma/yuboruvchilar.ts";
import { Pochta } from "../src/email/pochta.ts";
import { NAVBAT, Navbatlar, ishchi as worker, ulanish, type Job } from "../src/navbat/navbat.ts";
import { eslatmaIshlovi, tizimIshlovi, yetkazishIshlovi } from "../src/navbat/ishlovchilar.ts";
import { relay } from "../src/navbat/outbox.ts";
import { hodisaIshlovchisi, navbatgaTarqat } from "../src/navbat/tarqatish.ts";
import { xavfsizAgent } from "../src/webhook/ssrf.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";
import { randomBytes } from "node:crypto";

const REDIS = process.env["TEST_REDIS_URL"];
const API = process.env["MAILPIT_API"];
const baza = await authBaza("navbat");
const kutib = async <T>(f: () => Promise<T | undefined>, ms = 8000): Promise<T> => {
  const t0 = Date.now();
  for (;;) { const x = await f(); if (x !== undefined) return x; if (Date.now() - t0 > ms) throw new Error("kutish tugadi"); await new Promise((ok) => setTimeout(ok, 50)); }
};

if (typeof baza === "string" || REDIS === undefined || API === undefined) {
  test.skip(`BullMQ navbatlari (Postgres + Redis + Mailpit) — ${typeof baza === "string" ? baza : "TEST_REDIS_URL/MAILPIT_API yo'q"}`, () => {});
} else {
  const pool = baza;
  const ishchiPool = pgPool(Object.assign(new URL(pool.options.connectionString ?? ""), { username: "vazifalar_ishchi" }).toString(), { max: 5 });
  const prefiks = `t45-${String(process.pid)}`;
  const opt = ulanish(REDIS);
  const navbatlar = new Navbatlar(opt, prefiks);
  const markaz = new BildirishnomaMarkazi(ishchiPool, navbatlar.bildirishnomaNavbati());
  const pochta = new Pochta({ host: process.env["SMTP_HOST"] ?? "127.0.0.1", port: Number(process.env["SMTP_PORT"] ?? 0), secure: false, from: "Vazifalar <noreply@vazifalar.example.uz>" });
  const agent = xavfsizAgent();
  const d = { hodisa: hodisaIshlovchisi({ ishchi: ishchiPool, navbatlar }), ishchi: ishchiPool, markaz, yuboruvchilar: { email: emailYuboruvchi(pochta, { obunaKaliti: randomBytes(32), apiUrl: "http://api.test", ilovaUrl: "http://localhost:5173" }) }, yetkazishNavbati: navbatlar.yetkazish, webhook: { agent, httpRuxsat: true } };
  const workerlar = [
    worker(NAVBAT.eslatma, opt, eslatmaIshlovi(d), { prefiks }),
    worker(NAVBAT.yetkazish, opt, yetkazishIshlovi(d), { prefiks }),
    worker(NAVBAT.tizim, opt, tizimIshlovi(d), { prefiks, concurrency: 1 }),
  ];
  // holat 50: ishchi jarayondagi relay sikli o'rnida — qo'lda
  const relayQil = () => relay(ishchiPool, navbatgaTarqat(navbatlar));
  beforeAll(() => tozala(pool));
  afterAll(async () => {
    await Promise.all(workerlar.map((w) => w.close()));
    for (const q of [navbatlar.eslatma, navbatlar.yetkazish, navbatlar.tizim]) await q.obliterate({ force: true });
    await navbatlar.yop();
    pochta.yop();
    await agent.close();
    await ishchiPool.end();
    await pool.end();
  });
  const da = authBogliqliklari(pool);
  const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: da, navbat: { pool, navbatlar } });

  test("muddat → eslatma (delayed) → bildirishnoma → email yetkazildi; bajarildi → eslatma bekor; null/o'tgan/begona", async () => {
    const email = "aziz@example.com";
    const aziz = await hisobOch(app, da, email);
    const dil = await hisobOch(app, da, "dilnoza@example.com");
    const v = (await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Hisobot topshirish" }).expect(201)).body as { id: number };
    const muddat = new Date(Date.now() + 30 * 60_000 + 1500); // eslatma — muddatdan 30 daqiqa oldin → ~1.5 s dan keyin
    const m = (await request(app).put(`/v1/vazifalar/${String(v.id)}/muddat`).set("Cookie", aziz).send({ muddat: muddat.toISOString() }).expect(202)).body as { eslatma: string };
    assert.equal(m.eslatma, "rejalanadi");
    await relayQil(); // outbox: vazifa.yaratildi + vazifa.muddat → tizim navbati → eslatma rejalanadi
    await kutib(async () => ((await navbatlar.eslatma.getDelayedCount()) === 1 ? true : undefined));
    const b = await kutib(async () => (await pool.query<{ id: string; matn: string }>("SELECT id, matn FROM bildirishnomalar WHERE tur = 'vazifa.muddat'")).rows[0]);
    assert.match(b.matn, /^Hisobot topshirish — /);
    const y = await kutib(async () => (await pool.query<{ holat: string }>("SELECT holat FROM yetkazishlar WHERE bildirishnoma_id = $1 AND kanal = 'email' AND holat = 'yuborildi'", [b.id])).rows[0]);
    assert.equal(y.holat, "yuborildi");
    const xat = await kutib(async () => ((await (await fetch(`${API}/api/v1/search?query=${encodeURIComponent(`to:${email} subject:"Muddat yaqin"`)}`)).json()) as { messages: { Subject: string }[] }).messages[0]);
    assert.equal(xat.Subject, "Muddat yaqin");

    const v2 = (await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Non olish" }).expect(201)).body as { id: number };
    await request(app).put(`/v1/vazifalar/${String(v2.id)}/muddat`).set("Cookie", aziz).send({ muddat: new Date(Date.now() + 3 * 3600_000).toISOString() }).expect(202);
    await relayQil();
    await kutib(async () => ((await navbatlar.eslatma.getDelayedCount()) === 1 ? true : undefined));
    await request(app).patch(`/v1/vazifalar/${String(v2.id)}`).set("Cookie", aziz).set("Content-Type", "application/merge-patch+json").send({ bajarildi: true }).expect(200);
    await relayQil(); // vazifa.bajarildi → eslatma bekor
    await kutib(async () => ((await navbatlar.eslatma.getDelayedCount()) === 0 ? true : undefined));

    assert.equal(((await request(app).put(`/v1/vazifalar/${String(v2.id)}/muddat`).set("Cookie", aziz).send({ muddat: null }).expect(202)).body as { eslatma: string }).eslatma, "bekor qilinadi");
    await request(app).put(`/v1/vazifalar/${String(v2.id)}/muddat`).set("Cookie", dil).send({ muddat: null }).expect(404);
    await request(app).put(`/v1/vazifalar/${String(v2.id)}/muddat`).set("Cookie", aziz).send({ muddat: "ertaga" }).expect(422);
  });

  test("eslatma ishi eskirgan bo'lsa (muddat o'zgargan) — bildirishnoma yo'q; qolib ketgan yetkazish — qayta navbatga (yangi jobId)", async () => {
    const f = Number((await pool.query<{ id: string }>("SELECT id FROM foydalanuvchilar WHERE email = 'aziz@example.com'")).rows[0]?.id);
    const v = Number((await pool.query<{ id: string }>("INSERT INTO vazifalar (egasi_id, matn, muddat) VALUES ($1, 'Eski muddat', now() + interval '1 day') RETURNING id", [f])).rows[0]?.id);
    const ish = { data: { vazifaId: v, foydalanuvchiId: f, muddat: new Date(Date.now() + 3600_000).toISOString() } } as Job<{ vazifaId: number; foydalanuvchiId: number; muddat: string }>;
    assert.equal(await eslatmaIshlovi(d)(ish), "eskirgan");
    const b = Number((await ishchiPool.query<{ id: string }>("INSERT INTO bildirishnomalar (foydalanuvchi_id, tur, sarlavha, matn) VALUES ($1, 'tizim', 'Sinov', 'qolib ketgan') RETURNING id", [f])).rows[0]?.id);
    await ishchiPool.query("INSERT INTO yetkazishlar (bildirishnoma_id, kanal, yangilangan_vaqt) VALUES ($1, 'email', now() - interval '10 minutes')", [b]);
    assert.deepEqual(await tizimIshlovi(d)({ name: "qolib-ketgan" } as Job), { qaytaQoyildi: 1 });
    await kutib(async () => (await pool.query<{ holat: string }>("SELECT holat FROM yetkazishlar WHERE bildirishnoma_id = $1 AND holat = 'yuborildi'", [b])).rows[0]);
    await assert.rejects(tizimIshlovi(d)({ name: "nomalum" } as Job), /noma'lum tizim ishi/);
  });

  test("Bull Board /v1/admin/navbat — oddiy foydalanuvchi 403, admin 200 (3 navbat)", async () => {
    const aziz = await hisobOch(app, da, "bobur@example.com");
    await request(app).get("/v1/admin/navbat/api/queues").set("Cookie", aziz).expect(403);
    await pool.query("UPDATE foydalanuvchilar SET rol = 'admin' WHERE email = 'bobur@example.com'");
    const r = (await request(app).get("/v1/admin/navbat/api/queues").set("Cookie", aziz).expect(200)).body as { queues: { name: string }[] };
    assert.deepEqual(r.queues.map((q) => q.name).sort(), ["eslatmalar", "tizim", "yetkazishlar"]);
    await request(app).get("/v1/admin/navbat/api/queues").expect(401);
  });
}
