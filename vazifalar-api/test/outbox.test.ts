// outbox.test.ts — 29-qism B (holat 50): transactional outbox — vazifa yozuvi va hodisa BIR tranzaksiyada (rollback'da ikkalasi ham yo'q),
// relay → BullMQ (jobId = hodisa_id, takror yo'q) → tarqatish: SSE (Redis), webhook qatorlari (206), eslatma rejalash/bekor. Auth bazasi va Redis kerak.
import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import { createClient } from "redis";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori, pgPool } from "../src/vazifalar/pg-ombor.ts";
import { Navbatlar, ulanish } from "../src/navbat/navbat.ts";
import { relay, type OutboxHodisa } from "../src/navbat/outbox.ts";
import { hodisaIshlovchisi, navbatgaTarqat } from "../src/navbat/tarqatish.ts";
import { RedisTarqatuvchi } from "../src/realtime/sse.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";

const REDIS = process.env["TEST_REDIS_URL"];
const baza = await authBaza("outbox");
if (typeof baza === "string" || REDIS === undefined) {
  test.skip(`outbox (Postgres + Redis) — ${typeof baza === "string" ? baza : "TEST_REDIS_URL yo'q"}`, () => {});
} else {
  const pool = baza;
  const ishchi = pgPool(Object.assign(new URL(pool.options.connectionString ?? ""), { username: "vazifalar_ishchi" }).toString(), { max: 3 });
  const navbatlar = new Navbatlar(ulanish(REDIS), `t50-${String(process.pid)}`);
  const redis = createClient({ url: REDIS });
  const sub = createClient({ url: REDIS });
  const nashrlar: { fId: number; tur: string; malumot: { manba: string | null; tur: string; vazifaId: number } }[] = [];
  beforeAll(async () => {
    await Promise.all([redis.connect(), sub.connect()]);
    await sub.subscribe("vz:jonli", (x) => { nashrlar.push(JSON.parse(x) as (typeof nashrlar)[number]); });
    await tozala(pool);
  });
  afterAll(async () => {
    for (const q of [navbatlar.eslatma, navbatlar.yetkazish, navbatlar.tizim]) await q.obliterate({ force: true });
    await navbatlar.yop();
    redis.destroy(); sub.destroy();
    await ishchi.end(); await pool.end();
  });
  const d = authBogliqliklari(pool);
  const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, navbat: { pool, navbatlar } });
  const outbox = async () => (await pool.query<{ tur: string; manba: string | null; vazifa: number }>(
    "SELECT tur, malumot->>'manba' AS manba, (malumot->>'id')::int AS vazifa FROM outbox ORDER BY id")).rows;

  test("API yozuvlari → outbox (bir tranzaksiyada, manba bilan); takror matn 409 — hodisa ham yo'q (rollback)", async () => {
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const v = (await request(app).post("/v1/vazifalar").set("Cookie", aziz).set("X-Jonli-Manba", "oyna-7").send({ matn: "Non olish" }).expect(201)).body as { id: number };
    await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "NON OLISH" }).expect(409);
    await request(app).patch(`/v1/vazifalar/${String(v.id)}`).set("Cookie", aziz).set("Content-Type", "application/merge-patch+json").send({ bajarildi: true }).expect(200);
    await request(app).patch(`/v1/vazifalar/${String(v.id)}`).set("Cookie", aziz).set("Content-Type", "application/merge-patch+json").send({ bajarildi: true }).expect(200); // allaqachon — "bajarildi" takrorlanmaydi
    const m = (await request(app).put(`/v1/vazifalar/${String(v.id)}/muddat`).set("Cookie", aziz).send({ muddat: new Date(Date.now() + 5 * 3600_000).toISOString() }).expect(202)).body as { eslatma: string };
    assert.equal(m.eslatma, "rejalanadi");
    await request(app).delete(`/v1/vazifalar/${String(v.id)}`).set("Cookie", aziz).expect(204);
    assert.deepEqual((await outbox()).map((h) => `${h.tur}:${h.manba ?? "-"}:${String(h.vazifa)}`), [
      `vazifa.yaratildi:oyna-7:${String(v.id)}`, `vazifa.yangilandi:-:${String(v.id)}`, `vazifa.bajarildi:-:${String(v.id)}`,
      `vazifa.yangilandi:-:${String(v.id)}`, `vazifa.muddat:-:${String(v.id)}`, `vazifa.ochirildi:-:${String(v.id)}`,
    ]);
  });

  test("relay → tizim navbati (jobId = hodisa_id; ikkinchi relay — 0) → tarqatish: SSE, webhook qatorlari, eslatma", async () => {
    const f = Number((await pool.query<{ id: string }>("SELECT id FROM foydalanuvchilar WHERE email = 'aziz@example.com'")).rows[0]?.id);
    await pool.query("INSERT INTO webhook_obunalari (foydalanuvchi_id, url, sir) VALUES ($1, 'https://hook.example.uz/v', 'whsec_x')", [f]);
    const qoyildi: OutboxHodisa[] = [];
    const tarqat = navbatgaTarqat(navbatlar);
    const n1 = await relay(ishchi, async (h) => { qoyildi.push(h); await tarqat(h); });
    assert.deepEqual(n1, { tarqatildi: 6, xato: 0 });
    assert.deepEqual(await relay(ishchi, tarqat), { tarqatildi: 0, xato: 0 });
    await tarqat(qoyildi[0] ?? assert.fail()); // relay takrorlasa (at-least-once) — BullMQ jobId tufayli ish bitta
    assert.equal((await navbatlar.tizim.getJobs(["waiting", "prioritized"])).filter((j) => j.name === "hodisa").length, 6);

    const ishla = hodisaIshlovchisi({ ishchi, navbatlar, tarqatuvchi: new RedisTarqatuvchi(redis) });
    const natijalar = [];
    for (const h of qoyildi) natijalar.push(await ishla(h));
    assert.deepEqual(natijalar.map((x) => x.webhook), [1, 1, 1, 1, 0, 1]); // muddat — webhook hodisasi emas
    assert.deepEqual(natijalar.map((x) => x.eslatma), ["-", "-", "bekor 0", "-", "qoshildi", "bekor 1"]); // muddat → rejalandi, o'chirildi → bekor
    assert.equal(await ishla(qoyildi[0] ?? assert.fail()).then((x) => x.webhook), 0); // qayta ishlash — webhook takrorlanmaydi (obuna + hodisa_id UNIQUE)
    for (let i = 0; i < 40 && nashrlar.length < 7; i++) await new Promise((ok) => setTimeout(ok, 25));
    assert.deepEqual(nashrlar.slice(0, 6).map((x) => [x.fId, x.tur, x.malumot.tur]), qoyildi.map((h) => [f, "ozgardi", h.tur]));
    assert.equal(nashrlar[0]?.malumot.manba, "oyna-7");
  });
}
