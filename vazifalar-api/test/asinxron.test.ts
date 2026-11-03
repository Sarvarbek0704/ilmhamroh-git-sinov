// asinxron.test.ts — 31-qism #31 (BT-14): vaqtga bog'liq kodni SOXTA SOAT bilan testlash (kutmasdan): bayroqlar keshi (30 s TTL), AI javob keshi TTL,
// circuit breaker'ning ochiq oynasi va retry backoff'i haqiqiy setTimeout bilan — vi.useFakeTimers + advanceTimersByTimeAsync. Navbat (BullMQ), SSE, Mailpit,
// cron (ishchi) — mavjud integratsiya testlarida: navbat.test, jonli.test, bildirishnoma.test, saqlash.test (ishchi ishi), telegram-bot.test.
import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { BayroqlarXizmati } from "../src/bayroq/bayroqlar.ts";
import { XotiraKesh } from "../src/ai/nazorat.ts";
import { ChidamliProvayder } from "../src/ai/chidamli.ts";
import { SoxtaProvayder } from "../src/ai/soxta.ts";
import { LlmXatosi } from "../src/ai/llm.ts";

beforeEach(() => { vi.useFakeTimers({ now: new Date("2026-11-03T09:00:00Z") }); });
afterEach(() => { vi.useRealTimers(); });

test("bayroqlar keshi: 30 s ichida bazaga qayta bormaydi, 30 s dan keyin — boradi; tozala() — darhol", async () => {
  let sorovlar = 0;
  const pool = { query: () => { sorovlar++; return Promise.resolve({ rows: [{ kalit: "ai-qadamlar", yoqilgan: true, foiz: 100, rollar: [], foydalanuvchilar: [] }] }); } } as unknown as Pool;
  const b = new BayroqlarXizmati(pool);
  await b.yoqilganmi("ai-qadamlar", { id: 1 });
  vi.advanceTimersByTime(29_999);
  await b.yoqilganmi("ai-qadamlar", { id: 2 });
  assert.equal(sorovlar, 1);
  vi.advanceTimersByTime(1);
  await b.yoqilganmi("ai-qadamlar", { id: 3 });
  assert.equal(sorovlar, 2);
  b.tozala();
  await b.hammasi();
  assert.equal(sorovlar, 3);
});

test("AI javob keshi (xotira): TTL tugagach yo'q; chegara oshsa eng eskisi chiqadi", async () => {
  const k = new XotiraKesh(2);
  await k.yoz("a", "1", 60);
  vi.advanceTimersByTime(59_000);
  assert.equal(await k.ol("a"), "1");
  vi.advanceTimersByTime(1_001);
  assert.equal(await k.ol("a"), undefined);
  await k.yoz("b", "2", 60); await k.yoz("c", "3", 60); await k.yoz("d", "4", 60);
  assert.deepEqual([await k.ol("b"), await k.ol("c"), await k.ol("d")], [undefined, "3", "4"]);
});

test("retry backoff haqiqiy setTimeout bilan — soxta soat oldinga suriladi (test 0 ms kutadi); Retry-After 5 s hurmat qilinadi", async () => {
  const p = new SoxtaProvayder({ javob: () => "ok", xatolar: [new LlmXatosi("limit", "429", 5000, 429)] });
  const c = new ChidamliProvayder(p, { qaytaUrinish: 1 });
  let tugadi = false;
  const v = c.yarat({ tizim: "t", xabarlar: [{ rol: "user", matn: "x" }] }).then((j) => { tugadi = true; return j; });
  await vi.advanceTimersByTimeAsync(4_999);
  assert.equal(tugadi, false);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal((await v).matn, "ok");
  assert.equal(p.chaqiruvlar.length, 2);
});
