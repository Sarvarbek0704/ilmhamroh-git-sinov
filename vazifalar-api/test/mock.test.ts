// mock.test.ts — test double'lar: spy (vi.fn), stub (vi.spyOn), fake (soxta fetch, soxta ombor), soxta vaqt (vi.useFakeTimers).
// Qoida: o'zimizning chegaramizni soxtalaymiz (fetch tikuvi, ombor interfeysi) — Express, Nest yoki Zod ichini emas.
// 25–27 da node:test `t.mock` edi; Vitest'da `vi` (t.mock testdan keyin o'zi tiklanardi — vi'da afterEach'da vi.restoreAllMocks/useRealTimers)
import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";
import { webhookXabarchi } from "../src/umumiy/webhook.ts";
import { sorovId } from "../src/umumiy/sorov-id.ts";
import { httpIlova, xotiraLogi } from "./yordamchi.ts";

const kut = (ms: number) => new Promise((r) => setTimeout(r, ms));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("webhook: faqat false → true o'tishida, bitta marta; tana va URL to'g'ri (spy — vi.fn)", async () => {
  // typeof fetch imzosi — chaqiruv argumentlari tipli bo'lsin
  const soxtaFetch = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })));
  const { log, qatorlar } = xotiraLogi();
  const xabarchi = webhookXabarchi("https://hook.example.uz/v", { fetchFn: soxtaFetch, log: () => log });
  const app = await httpIlova({ ombor: new XotiraOmbori(), xabarchi });
  await request(app).post("/v1/vazifalar").send({ matn: "Non" }).expect(201);
  await request(app).patch("/v1/vazifalar/1").send({ matn: "Non olish" }).expect(200); // bajarildi o'zgarmadi
  await request(app).patch("/v1/vazifalar/1").send({ bajarildi: true }).expect(200);
  await request(app).patch("/v1/vazifalar/1").send({ bajarildi: true }).expect(200); // allaqachon true — qayta yuborilmaydi
  await kut(20);
  assert.equal(soxtaFetch.mock.calls.length, 1);
  const [url, init] = soxtaFetch.mock.calls[0] ?? [];
  assert.equal(url, "https://hook.example.uz/v");
  assert.equal(init?.method, "POST");
  assert.ok(typeof init.body === "string");
  assert.deepEqual((JSON.parse(init.body) as { vazifa: unknown }).vazifa, { id: 1, matn: "Non olish" });
  assert.ok(qatorlar.some((q) => q.msg === "webhook yuborildi" && q.status === 204));
});

test("webhook: tashqi server yiqilsa — javob baribir 200, xato logda (yutib yuborilmaydi)", async () => {
  const { log, qatorlar } = xotiraLogi();
  const xabarchi = webhookXabarchi("https://hook.example.uz/v", { fetchFn: () => Promise.reject(new TypeError("fetch failed")), log: () => log });
  const app = await httpIlova({ ombor: new XotiraOmbori(), xabarchi });
  await request(app).post("/v1/vazifalar").send({ matn: "a" }).expect(201);
  await request(app).patch("/v1/vazifalar/1").send({ bajarildi: true }).expect(200);
  await kut(20);
  assert.ok(qatorlar.some((q) => q.msg === "webhook yuborilmadi" && q.daraja === "warn"));
});

test("stub (vi.spyOn): ombor.yarat bir marta chaqirildi — Idempotency-Key takrorida ombor CHAQIRILMAYDI", async () => {
  const ombor = new XotiraOmbori();
  const yarat = vi.spyOn(ombor, "yarat");
  const app = await httpIlova({ ombor });
  for (let i = 0; i < 3; i++) await request(app).post("/v1/vazifalar").set("Idempotency-Key", "spy-0001").send({ matn: "bir marta" }).expect(201);
  assert.equal(yarat.mock.calls.length, 1);
});

test("soxta vaqt (vi.useFakeTimers, faqat Date): yaratildi va yangilandi — deterministik", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-24T05:00:00.000Z") });
  const app = await httpIlova({ ombor: new XotiraOmbori() });
  const r = await request(app).post("/v1/vazifalar").send({ matn: "a" }).expect(201);
  assert.equal((r.body as { yaratildi: string }).yaratildi, "2026-10-24T05:00:00.000Z");
  vi.setSystemTime(new Date("2026-10-24T05:01:30.000Z")); // 1.5 daqiqa "o'tdi" (toFake: Date — advanceTimersByTime taymer navbatini ham suradi)
  const p = await request(app).patch("/v1/vazifalar/1").send({ bajarildi: true }).expect(200);
  assert.equal((p.body as { yangilandi: string }).yangilandi, "2026-10-24T05:01:30.000Z");
});

test("soxta tasodif: sorovId generatori ukol qilinadi — UUID o'rniga ma'lum qiymat", () => {
  let n = 0;
  const mw = sorovId(() => `id-${String(++n).padStart(8, "0")}`);
  const sarlavhalar: Record<string, string> = {};
  const req = { get: () => undefined, sorovId: "" } as unknown as Parameters<typeof mw>[0];
  const res = { set: (k: string, v: string) => { sarlavhalar[k] = v; } } as unknown as Parameters<typeof mw>[1];
  mw(req, res, () => undefined);
  assert.equal(sarlavhalar["X-Request-Id"], "id-00000001");
});
