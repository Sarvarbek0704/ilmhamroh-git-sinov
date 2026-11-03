// breaker-regressiya.test.ts — 32-qism #01 (G-24): 31-qism kanon nuqsoni "umumiy circuit breaker" uchun REGRESSIYA testi.
//   Qora quti: config → provayderYarat() → haqiqiy GeminiProvayder + ChidamliProvayder + ZaxiraliProvayder zanjiri; tarmoq o'rniga soxta `fetch`
//   (asosiy model doim 503, zaxira model sog'). Shu sabab test 31-qismning har holatida (zaxira model paydo bo'lgandan beri) bir xil ishlaydi —
//   `git bisect run` uchun aynan shunday test kerak: u ichki tuzilishga emas, KUZATILADIGAN xulqqa tayanadi.
//   1-stsenariy (1 × 10, ketma-ket): o'lik asosiy model breaker'ni OCHISHI kerak — unga ko'pi bilan 5 ta chaqiruv (breaker chegarasi) ketadi.
//   2-stsenariy (8 × 2, parallel): asosiy breaker ochilganda ham SOG' zaxira to'silmasin — 16 so'rovning hammasi javob oladi.
//   BISECT_STSENARIY=1 yoki 2 — faqat bittasi (bisect uchun); berilmasa — ikkalasi.
import { afterEach, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { provayderYarat } from "../src/ai/ai.module.ts";
import type { Config } from "../src/config.ts";

const ASOSIY = "asosiy-model";
const ZAXIRA = "zaxira-model";
const asl = globalThis.fetch;
let chaqiruv = { asosiy: 0, zaxira: 0 };

const GEMINI_JAVOB = JSON.stringify({
  candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 },
});

beforeEach(() => {
  chaqiruv = { asosiy: 0, zaxira: 0 };
  globalThis.fetch = async (kirish: string | URL | Request) => {
    const url = typeof kirish === "string" ? kirish : kirish instanceof URL ? kirish.href : kirish.url;
    await new Promise((ok) => setTimeout(ok, 5)); // tarmoq kechikishi: parallel so'rovlar haqiqatan ustma-ust tushsin
    if (url.includes(`models/${ASOSIY}:`)) {
      chaqiruv.asosiy++;
      return new Response(JSON.stringify({ error: { status: "UNAVAILABLE", message: "o'lik" } }), { status: 503, headers: { "content-type": "application/json" } });
    }
    if (url.includes(`models/${ZAXIRA}:`)) {
      chaqiruv.zaxira++;
      return new Response(GEMINI_JAVOB, { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  };
});
afterEach(() => { globalThis.fetch = asl; });

function provayder() {
  const c = {
    AI_PROVAYDER: "gemini", GEMINI_API_KEY: "soxta-kalit-tarmoqqa-chiqmaydi", AI_MODEL: ASOSIY, AI_ZAXIRA_MODEL: ZAXIRA,
    AI_EMBEDDING_MODEL: "gemini-embedding-2", AI_TIMEOUT_MS: 1000, AI_QAYTA_URINISH: 2, AI_DEADLINE_MS: 25_000,
  } as unknown as Config;
  const p = provayderYarat(c);
  assert.ok(p !== null);
  return p;
}

const sorov = { tizim: "t", xabarlar: [{ rol: "user" as const, matn: "x" }] };
const stsenariy = process.env["BISECT_STSENARIY"];

describe("31 nuqsoni: umumiy circuit breaker (regressiya)", () => {
  test.runIf(stsenariy === undefined || stsenariy === "1")("1 × 10 ketma-ket: o'lik asosiy model breaker'ni ochadi (≤ 5 chaqiruv), hamma javob zaxiradan", async () => {
    const p = provayder();
    let ok = 0;
    for (let i = 0; i < 10; i++) if ((await p.yarat(sorov)).matn === "ok") ok++;
    console.log(`1×10: ok ${String(ok)}, chaqiruv ${JSON.stringify(chaqiruv)}`);
    assert.equal(ok, 10);
    assert.ok(chaqiruv.asosiy <= 5, `o'lik asosiy model ${String(chaqiruv.asosiy)} marta chaqirildi (breaker ochilmadi)`);
  }, 30_000);

  test.runIf(stsenariy === undefined || stsenariy === "2")("8 × 2 parallel: asosiy breaker ochiq bo'lsa ham sog' zaxira to'silmaydi (16/16)", async () => {
    const p = provayder();
    const natija: Record<string, number> = {};
    for (let aylana = 0; aylana < 2; aylana++) {
      const r = await Promise.allSettled(Array.from({ length: 8 }, () => p.yarat(sorov)));
      for (const x of r) {
        const k = x.status === "fulfilled" ? "ok" : (x.reason as { tur?: string }).tur ?? "xato";
        natija[k] = (natija[k] ?? 0) + 1;
      }
    }
    console.log(`8×2: javob ${JSON.stringify(natija)}, chaqiruv ${JSON.stringify(chaqiruv)}`);
    assert.equal(natija["ok"], 16, `zaxira to'sildi: ${JSON.stringify(natija)}`);
  }, 30_000);
});
