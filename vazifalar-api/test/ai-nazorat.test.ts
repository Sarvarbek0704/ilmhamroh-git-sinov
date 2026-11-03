// ai-nazorat.test.ts — 31-qism #19 (B-210): AI prodakshnda — kunlik kvota (atomik, parallel so'rovlarda ham), provayder xatosida kvota qaytadi, javob keshi
// (foydalanuvchi bo'yicha; matn o'zgarsa — yangi), statistika hodisalari matnsiz, hisob o'chirilsa ai_sarf ham ketadi (302 generik FK). Soxta provayder. Auth bazasi kerak.
import { afterAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "./yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { SoxtaProvayder } from "../src/ai/soxta.ts";
import { LlmXatosi } from "../src/ai/llm.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";

const QADAMLAR = JSON.stringify({ qadamlar: [{ matn: "Birinchi qadam", daqiqa: 10 }, { matn: "Ikkinchi qadam", daqiqa: 20 }] });

const baza = await authBaza("ai_nazorat");
if (typeof baza === "string") {
  test.skip(`AI kvota va kesh (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  beforeEach(() => tozala(pool));
  const ilova = async (p: SoxtaProvayder, kunlikSorov: number, vazifalar = 1) => {
    const d = authBogliqliklari(pool);
    const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, ai: { pool, provayder: p, kvota: { kunlikSorov, kunlikToken: 1_000_000 } } });
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const idlar: number[] = [];
    for (let i = 0; i < vazifalar; i++) idlar.push(((await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: `Vazifa ${String(i + 1)}` }).expect(201)).body as { id: number }).id);
    return { d, app, aziz, idlar };
  };
  const qadam = (app: Parameters<typeof request>[0], c: string, id: number | undefined) => request(app).post(`/v1/vazifalar/${String(id)}/qadamlar`).set("Cookie", c);

  test("kvota: 3 ta — 4-chisi 429 (Retry-After, ai-kvota); provayder xatosi kvotani yemaydi; GET /v1/yordamchi/kvota", async () => {
    const p = new SoxtaProvayder({ javob: () => QADAMLAR });
    const { app, aziz, idlar } = await ilova(p, 3, 5);
    p.s.xatolar = [new LlmXatosi("band", "503", undefined, 503)];
    await qadam(app, aziz, idlar[0]).expect(503); // qaytarildi
    for (const id of idlar.slice(0, 3)) await qadam(app, aziz, id).expect(200);
    const r = await qadam(app, aziz, idlar[3]).expect(429);
    assert.ok(Number(r.headers["retry-after"]) > 0 && Number(r.headers["retry-after"]) <= 86_400);
    assert.match((r.body as { type: string }).type, /ai-kvota$/);
    const k = (await request(app).get("/v1/yordamchi/kvota").set("Cookie", aziz).expect(200)).body as { kvota: { sorovlar: number; tokenlar: number; chegara: { sorovlar: number } } };
    assert.equal(k.kvota.sorovlar, 3);
    assert.ok(k.kvota.tokenlar > 0);
    assert.equal(p.chaqiruvlar.length, 4); // 503 + 3 ok; 429 da provayder chaqirilmadi
  });

  test("kvota atomik: chegara 5, 10 ta PARALLEL so'rov — aniq 5 ta 200, 5 ta 429", async () => {
    const { app, aziz, idlar } = await ilova(new SoxtaProvayder({ javob: () => QADAMLAR, kechikishMs: 50 }), 5, 10);
    const kodlar = (await Promise.all(idlar.map((id) => qadam(app, aziz, id)))).map((r) => r.status).sort();
    assert.deepEqual(kodlar, [200, 200, 200, 200, 200, 429, 429, 429, 429, 429]);
  });

  test("kesh: bir xil vazifa — ikkinchisi kesh:true (LLM yo'q, kvota yo'q); matn o'zgarsa — yangi; SSE ham keshdan; hodisalar matnsiz", async () => {
    const p = new SoxtaProvayder({ javob: () => QADAMLAR });
    const { app, aziz, idlar } = await ilova(p, 10);
    assert.equal(((await qadam(app, aziz, idlar[0]).expect(200)).body as { kesh: boolean }).kesh, false);
    assert.equal(((await qadam(app, aziz, idlar[0]).expect(200)).body as { kesh: boolean }).kesh, true);
    const sse = await qadam(app, aziz, idlar[0]).set("Accept", "text/event-stream").buffer(true).parse((res, cb) => { let t = ""; res.on("data", (c: Buffer) => { t += c.toString(); }); res.on("end", () => { cb(null, t); }); }).expect(200);
    assert.match(sse.body as string, /"kesh":true/);
    assert.equal(p.chaqiruvlar.length, 1);
    await request(app).patch(`/v1/vazifalar/${String(idlar[0])}`).set("Cookie", aziz).set("Content-Type", "application/merge-patch+json").send({ matn: "Vazifa 1 yangilandi" }).expect(200);
    assert.equal(((await qadam(app, aziz, idlar[0]).expect(200)).body as { kesh: boolean }).kesh, false);
    assert.equal(p.chaqiruvlar.length, 2);
    const k = (await request(app).get("/v1/yordamchi/kvota").set("Cookie", aziz).expect(200)).body as { kvota: { sorovlar: number } };
    assert.equal(k.kvota.sorovlar, 2);
    const h = (await pool.query<{ malumot: Record<string, unknown> }>("SELECT malumot FROM vazifa_hodisalari WHERE tur = 'ai_qadamlar' ORDER BY vaqt")).rows.map((r) => r.malumot);
    assert.deepEqual(h.map((m) => m["kesh"]), [false, true, true, false]);
    assert.ok(h.every((m) => !JSON.stringify(m).includes("Vazifa") && !JSON.stringify(m).includes("qadam"))); // matn yo'q
  });

  test("hisob o'chirilsa ai_sarf ham o'chadi — 302 generik FK sikli yangi jadvalni o'zi topdi", async () => {
    const { app, aziz, idlar } = await ilova(new SoxtaProvayder({ javob: () => QADAMLAR }), 10);
    await qadam(app, aziz, idlar[0]).expect(200);
    const { rows: [f] } = await pool.query<{ id: string }>("SELECT id FROM foydalanuvchilar WHERE email = 'aziz@example.com'");
    const n = (await pool.query<{ n: Record<string, number> }>("SELECT hisob_anonimlashtir($1) AS n", [f?.id])).rows[0]?.n ?? {};
    assert.equal(n["ai_sarf"], 1);
    assert.equal((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM ai_sarf")).rows[0]?.n, 0);
  });
}
