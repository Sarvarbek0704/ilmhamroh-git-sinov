// nuqsonlar-31.test.ts — 32-qism #01: 31-qism kanonidan qolgan nuqsonlar uchun REGRESSIYA testlari (har biri — eski kodda yiqiladi, yangisida o'tadi).
//   2) AI umumiy deadline (AI_DEADLINE_MS) — JSON va SSE'da 504, provayder signali bekor; 3) DEFAULT bo'lim — qatorlar ko'chadi, xato yutilmaydi (log + metrika);
//   4) gemini-embedding-2 — taskType o'rniga prefiks (soxta fetch); 5) oqim uzilsa kvota QAYTMAYDI, taxminiy token yoziladi.
//   (1 — breaker-regressiya.test.ts; 6 — prodakshn.test.ts audit kutuvi; 7 — mcp.test.ts annotatsiyalar.)
import { afterAll, afterEach, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { expressIlova } from "./yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import type { LlmBolak, LlmJavob, LlmProvayder, LlmSorov } from "../src/ai/llm.ts";
import { embeddingMatni, embeddingYorligi, GeminiProvayder } from "../src/ai/gemini.ts";
import { taxminiyToken } from "../src/ai/qadamlar.ts";
import { BolimlarXizmati } from "../src/statistika/statistika.module.ts";
import { fonXatolari } from "../src/kuzatuv/metrikalar.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";

/** signal bekor qilinguncha kutadigan va'da (provayder "osilib qolgan") */
const bekorKut = (signal: AbortSignal | undefined): Promise<never> => new Promise((_, rad) => {
  if (signal === undefined) return;
  if (signal.aborted) { rad(signal.reason as Error); return; }
  signal.addEventListener("abort", () => { rad(signal.reason as Error); }, { once: true });
});

/** test provayderi: yarat — osiladi; oqim — `oldin` bo'lagini beradi, keyin osiladi (signal kelguncha) */
class OsiluvchiProvayder implements LlmProvayder {
  readonly nom = "osiluvchi";
  readonly model = "osiluvchi-1";
  readonly signallar: (AbortSignal | undefined)[] = [];
  constructor(private readonly oldin: string[] = []) {}
  yarat(s: LlmSorov): Promise<LlmJavob> {
    this.signallar.push(s.signal);
    return bekorKut(s.signal);
  }
  async *oqim(s: LlmSorov): AsyncIterable<LlmBolak> {
    this.signallar.push(s.signal);
    for (const matn of this.oldin) yield { tur: "matn", matn };
    await bekorKut(s.signal);
  }
  embedding(): Promise<number[][]> {
    return Promise.reject(new Error("kerak emas"));
  }
}

describe("4) gemini-embedding-2: taskType o'rniga prefiks (soxta fetch — tarmoqqa chiqmaydi)", () => {
  const asl = globalThis.fetch;
  let tanalar: { url: string; tana: { requests: Record<string, unknown>[] } }[] = [];
  beforeEach(() => {
    tanalar = [];
    globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
      const tana = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { requests: Record<string, unknown>[] };
      tanalar.push({ url: url instanceof Request ? url.url : url.toString(), tana });
      return Promise.resolve(new Response(JSON.stringify({ embeddings: tana.requests.map(() => ({ values: [3, 4] })) }), { status: 200 }));
    };
  });
  afterEach(() => { globalThis.fetch = asl; });

  test("gemini-embedding-2: so'rov — `task: search result | query:`, hujjat — `title: none | text:`, taskType YO'Q; 001 — taskType qoladi", async () => {
    const p = new GeminiProvayder({ kalit: "soxta", model: "m", embeddingModel: "gemini-embedding-2", timeoutMs: 1000, embeddingOlcham: 2 });
    assert.deepEqual(await p.embedding(["sut olish"], "sorov"), [[0.6, 0.8]]);
    await p.embedding(["Non va sut olish", "Hisobot"], "hujjat");
    const [s, h] = tanalar;
    assert.deepEqual(s?.tana.requests[0], { model: "models/gemini-embedding-2", content: { parts: [{ text: "task: search result | query: sut olish" }] }, outputDimensionality: 2 });
    assert.equal((h?.tana.requests[1]?.["content"] as { parts: { text: string }[] }).parts[0]?.text, "title: none | text: Hisobot");
    assert.ok(tanalar.every((t) => t.tana.requests.every((r) => !("taskType" in r))));
    const eski = new GeminiProvayder({ kalit: "soxta", model: "m", embeddingModel: "gemini-embedding-001", timeoutMs: 1000, embeddingOlcham: 2 });
    await eski.embedding(["x"], "sorov");
    assert.equal(tanalar.at(-1)?.tana.requests[0]?.["taskType"], "RETRIEVAL_QUERY");
    assert.equal((tanalar.at(-1)?.tana.requests[0]?.["content"] as { parts: { text: string }[] }).parts[0]?.text, "x");
    // bazadagi yorliq o'zgaradi → eski (prefikssiz) vektorlar dangasa qayta hisoblanadi
    assert.equal(embeddingYorligi("gemini-embedding-2"), "gemini-embedding-2+prefiks");
    assert.equal(embeddingYorligi("gemini-embedding-001"), "gemini-embedding-001");
    assert.equal(embeddingMatni("a", "hujjat"), "title: none | text: a");
  });
});

test("5) taxminiyToken: kirish (tizim + xabarlar) va chiqish, ~4 belgi = 1 token", () => {
  assert.equal(taxminiyToken({ tizim: "12345678", xabarlar: [{ rol: "user", matn: "1234" }] }, "12345"), 3 + 2);
});

const baza = await authBaza("nuqsonlar31");
if (typeof baza === "string") {
  test.skip(`31 nuqsonlari (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  beforeEach(() => tozala(pool));
  const ilova = async (provayder: LlmProvayder, deadlineMs = 25_000) => {
    const d = authBogliqliklari(pool);
    const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, ai: { pool, provayder, deadlineMs, kvota: { kunlikSorov: 10, kunlikToken: 1_000_000 } } });
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const id = ((await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Hisobot yozish" }).expect(201)).body as { id: number }).id;
    return { app, aziz, id };
  };
  const sarf = async () => (await pool.query<{ sorovlar: number; tokenlar: number }>("SELECT sorovlar, tokenlar FROM ai_sarf")).rows[0] ?? { sorovlar: 0, tokenlar: 0 };

  test("2) deadline: provayder osilib qolsa — JSON 504 (ai-timeout) ~deadline'da, signal bekor, kvota qaytdi; SSE — `event: xato` 504", async () => {
    const p = new OsiluvchiProvayder();
    const { app, aziz, id } = await ilova(p, 300);
    const t0 = performance.now();
    const r = await request(app).post(`/v1/vazifalar/${String(id)}/qadamlar`).set("Cookie", aziz).expect(504);
    const ms = performance.now() - t0;
    assert.match((r.body as { type: string }).type, /ai-timeout$/);
    assert.ok(ms >= 250 && ms < 5000, `javob ${String(Math.round(ms))} ms da`);
    assert.equal(p.signallar[0]?.aborted, true);
    assert.equal((await sarf()).sorovlar, 0); // JSON: deadline — provayder xatosi kabi, kvota qaytadi
    const sse = await request(app).post(`/v1/vazifalar/${String(id)}/qadamlar`).set("Cookie", aziz).set("Accept", "text/event-stream").buffer(true)
      .parse((res, cb) => { let t = ""; res.on("data", (c: Buffer) => { t += c.toString(); }); res.on("end", () => { cb(null, t); }); }).expect(200);
    assert.match(sse.body as string, /^event: xato\ndata: .*"status":504/m);
  });

  test("5) oqim: birinchi qadamdan keyin mijoz uzsa — kvota QAYTMAYDI, taxminiy tokenlar yoziladi (31 kanonida: 0 va 0)", async () => {
    const p = new OsiluvchiProvayder([`{"qadamlar":[{"matn":"Manbalarni yig'ish","daqiqa":20},`]);
    const { app, aziz, id } = await ilova(p);
    const srv = createServer(app).listen(0, "127.0.0.1");
    await once(srv, "listening");
    try {
      const a = new AbortController();
      const r = await fetch(`http://127.0.0.1:${String((srv.address() as AddressInfo).port)}/v1/vazifalar/${String(id)}/qadamlar`, { method: "POST", headers: { cookie: aziz, accept: "text/event-stream" }, signal: a.signal });
      const o = r.body?.getReader();
      let matn = "";
      for (let i = 0; i < 50 && !matn.includes("event: qadam"); i++) {
        const b = await o?.read();
        if (b === undefined || b.done) break;
        matn += new TextDecoder().decode(b.value);
      }
      assert.match(matn, /event: qadam/);
      a.abort();
      let s = await sarf();
      for (let i = 0; i < 200 && s.tokenlar === 0; i++) { await new Promise((ok) => setTimeout(ok, 10)); s = await sarf(); }
      assert.equal(p.signallar[0]?.aborted, true);
      assert.equal(s.sorovlar, 1); // 31 kanonida: 0 (qaytarilgan)
      assert.ok(s.tokenlar > 0, `tokenlar ${String(s.tokenlar)}`); // 31 kanonida: 0
    } finally {
      srv.close();
    }
  });

  test("3) DEFAULT bo'lim: shu oy qatorlari bo'lsa ham bo'lim yaratiladi (qatorlar ko'chadi); xato — error log + metrika, yutilmaydi", async () => {
    await pool.query("INSERT INTO vazifa_hodisalari (vaqt, egasi_id, tur) VALUES ('2032-05-10', 1, 'yaratildi'), ('2032-05-11', 1, 'bajarildi'), ('2032-06-01', 1, 'yaratildi')");
    assert.equal((await pool.query<{ n: string }>("SELECT hodisa_bolimi_yarat(date '2032-05-01') AS n")).rows[0]?.n, "vazifa_hodisalari_2032_05");
    const { rows } = await pool.query<{ b: string; n: number }>("SELECT tableoid::regclass::text AS b, count(*)::int AS n FROM vazifa_hodisalari WHERE vaqt >= '2032-01-01' GROUP BY 1 ORDER BY 1");
    assert.deepEqual(rows, [{ b: "bolimlar.vazifa_hodisalari_2032_05", n: 2 }, { b: "bolimlar.vazifa_hodisalari_boshqa", n: 1 }]);
    await pool.query("SELECT hodisa_bolimi_yarat(date '2032-06-01')");
    await pool.query("ALTER TABLE vazifa_hodisalari DETACH PARTITION bolimlar.vazifa_hodisalari_2032_05; DROP TABLE bolimlar.vazifa_hodisalari_2032_05");
    await pool.query("ALTER TABLE vazifa_hodisalari DETACH PARTITION bolimlar.vazifa_hodisalari_2032_06; DROP TABLE bolimlar.vazifa_hodisalari_2032_06");

    const xatolar: unknown[] = [];
    const oldin = (await fonXatolari.get()).values.find((v) => v.labels["ish"] === "hodisa-bolimlari")?.value ?? 0;
    const buzuq = { query: () => Promise.reject(new Error("baza o'chiq")) };
    const x = new BolimlarXizmati({ pool: buzuq as never }, { warn: () => undefined, error: (o: unknown) => { xatolar.push(o); } } as never);
    await assert.rejects(x.tayyorla(), /baza o'chiq/);
    await x.onApplicationBootstrap(); // ishga tushish to'xtamaydi
    const keyin = (await fonXatolari.get()).values.find((v) => v.labels["ish"] === "hodisa-bolimlari")?.value ?? 0;
    assert.equal(keyin - oldin, 2);
    assert.equal(xatolar.length, 2);
  });
}
