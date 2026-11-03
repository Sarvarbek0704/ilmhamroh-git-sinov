// chidamlilik.test.ts — 31-qism #29 (B-220): ChidamliProvayder — retry (faqat vaqtinchalik, Retry-After), circuit breaker (yopiq → ochiq → yarim → yopiq),
// bulkhead (parallel chegarasi). Soxta provayder va soxta soat/kutish — tarmoqsiz, tez.
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { SoxtaProvayder } from "../src/ai/soxta.ts";
import { LlmXatosi } from "../src/ai/llm.ts";
import type { LlmSorov } from "../src/ai/llm.ts";
import { ChidamliProvayder } from "../src/ai/chidamli.ts";

const S: LlmSorov = { tizim: "t", xabarlar: [{ rol: "user", matn: "x" }] };
const band = () => new LlmXatosi("band", "503", undefined, 503);

describe("#29 ChidamliProvayder", () => {
  test("retry: 2 ta vaqtinchalik xato → 3-urinishda muvaffaqiyat; kutishlar ≤ asos·2^n, Retry-After ustun; doimiy xato — qayta urinilmaydi", async () => {
    const kutishlar: number[] = [];
    const p = new SoxtaProvayder({ javob: () => "ok", xatolar: [band(), new LlmXatosi("limit", "429", 2000, 429)] });
    const c = new ChidamliProvayder(p, { qaytaUrinish: 2, asosMs: 100, kut: (ms) => { kutishlar.push(ms); return Promise.resolve(); } });
    assert.equal((await c.yarat(S)).matn, "ok");
    assert.equal(p.chaqiruvlar.length, 3);
    assert.ok((kutishlar[0] ?? -1) >= 0 && (kutishlar[0] ?? 999) <= 100);
    assert.ok((kutishlar[1] ?? 0) >= 2000); // Retry-After
    p.s.xatolar = [new LlmXatosi("notogri", "sxema")];
    await assert.rejects(c.yarat(S), /sxema/);
    assert.equal(p.chaqiruvlar.length, 4);
  });

  test("circuit breaker: 3 ketma-ket xato → ochiq (provayder chaqirilmaydi, darhol 'ochiq'); vaqt o'tgach yarim-ochiq — muvaffaqiyat yopadi, xato qayta ochadi", async () => {
    let t = 0;
    const p = new SoxtaProvayder({ javob: () => "ok", xatolar: [band(), band(), band()] });
    const c = new ChidamliProvayder(p, { qaytaUrinish: 0, breakerChegara: 3, breakerOchiqMs: 10_000, soat: () => t, kut: () => Promise.resolve() });
    for (let i = 0; i < 3; i++) await assert.rejects(c.yarat(S), /503/);
    assert.equal(c.holat, "ochiq");
    await assert.rejects(c.yarat(S), (x: unknown) => x instanceof LlmXatosi && x.tur === "ochiq");
    assert.equal(p.chaqiruvlar.length, 3);
    t = 10_000;
    assert.equal(c.holat, "yarim");
    p.s.xatolar = [band()];
    await assert.rejects(c.yarat(S), /503/);
    assert.equal(c.holat, "ochiq"); // yarim-ochiqdagi bitta xato — yana ochiq
    t = 20_000;
    assert.equal((await c.yarat(S)).matn, "ok");
    assert.equal(c.holat, "yopiq");
    assert.equal(c.hisob.breakerRad, 1);
  });

  test("bulkhead: maksParallel=2 — uchinchi parallel chaqiruv darhol 'band'; joy bo'shasa — yana o'tadi", async () => {
    const p = new SoxtaProvayder({ javob: () => "ok", kechikishMs: 50 });
    const c = new ChidamliProvayder(p, { qaytaUrinish: 0, maksParallel: 2 });
    const natijalar = await Promise.allSettled([c.yarat(S), c.yarat(S), c.yarat(S)]);
    assert.deepEqual(natijalar.map((n) => n.status), ["fulfilled", "fulfilled", "rejected"]);
    assert.equal(c.hisob.bulkheadRad, 1);
    assert.equal((await c.yarat(S)).matn, "ok");
  });
});
