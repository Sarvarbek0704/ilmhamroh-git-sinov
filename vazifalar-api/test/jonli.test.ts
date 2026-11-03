// jonli.test.ts — 29-qism B (holat 38): SSE /v1/oqim — ikki API nusxasi (har biri o'z hub'i, Redis Pub/Sub orqali), sessiya cookie bilan;
// hodisa formati 19-qism frontendiga mos (event: ozgardi, data.manba = X-Jonli-Manba), Last-Event-ID — Redis Stream'dan. Auth bazasi va Redis kerak.
import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "redis";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { RedisTarqatuvchi, SseHub } from "../src/realtime/sse.ts";
import { jonliXabarchi } from "../src/realtime/jonli.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";

const REDIS = process.env["TEST_REDIS_URL"];
const baza = await authBaza("jonli");

/** Oddiy SSE o'quvchi (fetch oqimi): kelgan hodisalar ro'yxati */
async function tingla(url: string, cookie: string, lastEventId?: string) {
  const ac = new AbortController();
  const r = await fetch(url, { headers: { cookie, accept: "text/event-stream", ...(lastEventId ? { "last-event-id": lastEventId } : {}) }, signal: ac.signal });
  const hodisalar: { id: string; event: string; data: unknown }[] = [];
  let bosh = "";
  let retry = "";
  void (async () => {
    try {
      for await (const b of r.body ?? []) {
        bosh += Buffer.from(b as Uint8Array).toString();
        let i: number;
        while ((i = bosh.indexOf("\n\n")) >= 0) {
          const blok = bosh.slice(0, i); bosh = bosh.slice(i + 2);
          const m = Object.fromEntries(blok.split("\n").filter((q) => !q.startsWith(":")).map((q) => [q.slice(0, q.indexOf(":")), q.slice(q.indexOf(":") + 2)]));
          if (m["retry"]) retry = m["retry"];
          if (m["event"]) hodisalar.push({ id: m["id"] ?? "", event: m["event"], data: JSON.parse(m["data"] ?? "null") });
        }
      }
    } catch { /* abort */ }
  })();
  return { status: r.status, tur: r.headers.get("content-type"), hodisalar, retry: () => retry, yop: () => { ac.abort(); } };
}
const kutib = async <T>(f: () => T | undefined, ms = 3000): Promise<T> => {
  const t0 = Date.now();
  for (;;) { const x = f(); if (x !== undefined) return x; if (Date.now() - t0 > ms) throw new Error("kutish tugadi"); await new Promise((ok) => setTimeout(ok, 15)); }
};

if (typeof baza === "string" || REDIS === undefined) {
  test.skip(`SSE (Postgres + Redis) — ${typeof baza === "string" ? baza : "TEST_REDIS_URL yo'q"}`, () => {});
} else {
  const pool = baza;
  const redis = createClient({ url: REDIS });
  const sub1 = createClient({ url: REDIS });
  const sub2 = createClient({ url: REDIS });
  const serverlar: Server[] = [];
  const hublar: SseHub[] = [];
  beforeAll(async () => { await Promise.all([redis.connect(), sub1.connect(), sub2.connect()]); await tozala(pool); });
  afterAll(async () => { for (const h of hublar) h.yop(); for (const s of serverlar) s.close(); redis.destroy(); sub1.destroy(); sub2.destroy(); await pool.end(); });
  const d = authBogliqliklari(pool);
  const tarqatuvchi = new RedisTarqatuvchi(redis);
  /** API nusxasi: o'z hub'i, o'z subscriber'i — umumiy faqat Redis va Postgres */
  const nusxa = async (sub: typeof sub1) => {
    const hub = new SseHub({ tarix: tarqatuvchi.tarix() });
    hublar.push(hub);
    await RedisTarqatuvchi.tingla(sub, hub);
    const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, jonli: hub, xabarchiFabrika: jonliXabarchi({ hub, tarqatuvchi, log: () => ({ warn: () => undefined }) }) });
    const s = createServer(app).listen(0, "127.0.0.1");
    await once(s, "listening");
    serverlar.push(s);
    return { app, url: `http://127.0.0.1:${String((s.address() as AddressInfo).port)}` };
  };

  test("nusxa A da yozish → nusxa B dagi oynaga hodisa; manba belgisi; begonaga yo'q; Last-Event-ID bilan o'tkazib yuborilganlar; sessiyasiz 401", async () => {
    const a = await nusxa(sub1);
    const b = await nusxa(sub2);
    const aziz = await hisobOch(a.app, d, "aziz@example.com");
    const dil = await hisobOch(a.app, d, "dilnoza@example.com");
    assert.equal((await fetch(`${b.url}/v1/oqim`)).status, 401);
    const oyna = await tingla(`${b.url}/v1/oqim`, aziz);
    const begona = await tingla(`${b.url}/v1/oqim`, dil);
    assert.deepEqual([oyna.status, oyna.tur], [200, "text/event-stream; charset=utf-8"]);
    await kutib(() => (oyna.retry() === "2000" ? true : undefined));

    const v = (await request(a.app).post("/v1/vazifalar").set("Cookie", aziz).set("X-Jonli-Manba", "oyna-1").send({ matn: "Non olish" }).expect(201)).body as { id: number };
    const h1 = await kutib(() => oyna.hodisalar[0]);
    assert.deepEqual([h1.event, h1.data], ["ozgardi", { manba: "oyna-1", tur: "vazifa.yaratildi", vazifaId: v.id }]);
    assert.match(h1.id, /^\d+-\d+$/);
    oyna.yop();
    // Oyna uzilgan paytda ikki o'zgarish — qayta ulanganda Last-Event-ID dan keyingilari (Stream)
    await request(a.app).patch(`/v1/vazifalar/${String(v.id)}`).set("Cookie", aziz).set("Content-Type", "application/merge-patch+json").send({ matn: "Non va sut olish" }).expect(200);
    await request(a.app).delete(`/v1/vazifalar/${String(v.id)}`).set("Cookie", aziz).expect(204);
    const qayta = await tingla(`${b.url}/v1/oqim`, aziz, h1.id);
    const tiklangan = await kutib(() => (qayta.hodisalar.length >= 2 ? qayta.hodisalar : undefined));
    assert.deepEqual(tiklangan.map((x) => (x.data as { tur: string; manba: string | null }).tur), ["vazifa.yangilandi", "vazifa.ochirildi"]);
    assert.equal((tiklangan[0]?.data as { manba: string | null }).manba, null);
    qayta.yop();
    await new Promise((ok) => setTimeout(ok, 100));
    assert.equal(begona.hodisalar.length, 0);
    begona.yop();
  });
}
