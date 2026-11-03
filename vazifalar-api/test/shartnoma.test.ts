// shartnoma.test.ts — 31-qism #32 (BT-15): shartnoma (contract) testlari.
//   (1) OpenAPI SNAPSHOT (30-qism Swagger, /docs-json) — `docs/openapi-snapshot.json` bilan solishtiriladi: olib tashlangan operatsiya/parametr, yangi MAJBURIY tana maydoni,
//       tana maydonining turi o'zgarishi — BREAKING (test yiqiladi); qo'shimchalar — ruxsat (ro'yxati chiqariladi). Ataylab o'zgartirilganda: `SHARTNOMA_YANGILA=1 npx vitest run test/shartnoma.test.ts`.
//   (2) ISTE'MOLCHI shartnomasi (Pact g'oyasi, kutubxonasiz): frontend (22-qism `vazifalar`) TAYANADIGAN javob shakllari — Zod bilan, haqiqiy javoblarga qarshi.
//       Topilma: Swagger hujjatida javob sxemalari YO'Q (faqat "200": {description}) — javob shartnomasini OpenAPI'dan tekshirib bo'lmaydi, shuning uchun (2).
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import request from "supertest";
import { z } from "zod";
import { expressIlova } from "./yordamchi.ts";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";

type Hujjat = { paths: Record<string, Record<string, { parameters?: { name: string; in: string; required?: boolean }[]; requestBody?: { content: Record<string, { schema: unknown }> }; responses: Record<string, unknown> }>> };
type Operatsiya = { parametrlar: string[]; tana: Record<string, { tur: string; majburiy: boolean }> | null; javoblar: string[] };

const SNAPSHOT = new URL("../docs/openapi-snapshot.json", import.meta.url);

/** OpenAPI → solishtirish uchun ixcham shakl: "METOD /yo'l" → parametrlar, tana maydonlari (tur, majburiy), javob kodlari */
export function normallashtir(h: Hujjat): Record<string, Operatsiya> {
  const n: Record<string, Operatsiya> = {};
  for (const [yol, ops] of Object.entries(h.paths)) for (const [metod, o] of Object.entries(ops)) {
    const s = Object.values(o.requestBody?.content ?? {})[0]?.schema as { properties?: Record<string, { type?: unknown }>; required?: string[] } | undefined;
    n[`${metod.toUpperCase()} ${yol}`] = {
      parametrlar: (o.parameters ?? []).map((p) => `${p.in}:${p.name}${p.required === true ? "!" : ""}`).sort(),
      tana: s?.properties === undefined ? null : Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, { tur: JSON.stringify(v.type ?? "?"), majburiy: (s.required ?? []).includes(k) }])),
      javoblar: Object.keys(o.responses).sort(),
    };
  }
  return n;
}

/** eski → yangi: breaking o'zgarishlar ro'yxati (bo'sh — mos) */
export function buzilishlar(eski: Record<string, Operatsiya>, yangi: Record<string, Operatsiya>): string[] {
  const b: string[] = [];
  for (const [op, e] of Object.entries(eski)) {
    const y = yangi[op];
    if (y === undefined) { b.push(`${op}: olib tashlandi`); continue; }
    for (const p of e.parametrlar) if (!y.parametrlar.includes(p) && !y.parametrlar.includes(p.replace(/!$/, ""))) b.push(`${op}: parametr ${p} olib tashlandi`);
    for (const p of y.parametrlar) if (p.endsWith("!") && !e.parametrlar.includes(p)) b.push(`${op}: yangi MAJBURIY parametr ${p}`);
    for (const [k, t] of Object.entries(y.tana ?? {})) {
      const et = e.tana?.[k];
      if (t.majburiy && et?.majburiy !== true) b.push(`${op}: tana.${k} endi majburiy`);
      if (et !== undefined && et.tur !== t.tur) b.push(`${op}: tana.${k} turi ${et.tur} → ${t.tur}`);
    }
    for (const k of Object.keys(e.tana ?? {})) if (y.tana?.[k] === undefined) b.push(`${op}: tana.${k} olib tashlandi (strict sxemada mijoz yuborsa — 422)`);
    for (const j of e.javoblar) if (!y.javoblar.includes(j)) b.push(`${op}: javob ${j} olib tashlandi`);
  }
  return b;
}

const app = await expressIlova({ ombor: new XotiraOmbori() });

test("OpenAPI snapshot: breaking o'zgarish yo'q (qo'shimchalar — ruxsat)", async () => {
  const joriy = normallashtir((await request(app).get("/docs-json").expect(200)).body as Hujjat);
  if (process.env["SHARTNOMA_YANGILA"] === "1" || !existsSync(SNAPSHOT)) writeFileSync(SNAPSHOT, `${JSON.stringify(joriy, null, 2)}\n`);
  const eski = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, Operatsiya>;
  assert.deepEqual(buzilishlar(eski, joriy), []);
  const yangi = Object.keys(joriy).filter((k) => !(k in eski));
  assert.ok(Array.isArray(yangi)); // yangi operatsiyalar — breaking emas
});

test("solishtirgich o'zi: parametr olib tashlash, majburiy maydon, tur o'zgarishi, operatsiya o'chirish — ushlanadi", () => {
  const eski: Record<string, Operatsiya> = { "GET /v1/vazifalar": { parametrlar: ["query:teg", "query:limit"], tana: null, javoblar: ["200"] },
    "POST /v1/vazifalar": { parametrlar: [], tana: { matn: { tur: "\"string\"", majburiy: true }, muddat: { tur: "\"string\"", majburiy: false } }, javoblar: ["201"] },
    "DELETE /v1/vazifalar/{id}": { parametrlar: ["path:id!"], tana: null, javoblar: ["204"] } };
  const yangi: Record<string, Operatsiya> = { "GET /v1/vazifalar": { parametrlar: ["query:limit", "query:sahifa!"], tana: null, javoblar: ["200"] },
    "POST /v1/vazifalar": { parametrlar: [], tana: { matn: { tur: "\"string\"", majburiy: true }, muddat: { tur: "\"integer\"", majburiy: true } }, javoblar: ["201"] } };
  assert.deepEqual(buzilishlar(eski, yangi).sort(), [
    "DELETE /v1/vazifalar/{id}: olib tashlandi", "GET /v1/vazifalar: parametr query:teg olib tashlandi", "GET /v1/vazifalar: yangi MAJBURIY parametr query:sahifa!",
    "POST /v1/vazifalar: tana.muddat endi majburiy", "POST /v1/vazifalar: tana.muddat turi \"string\" → \"integer\"",
  ].sort());
});

// Frontend (22-qism) tayanadigan maydonlar — ortiqcha maydon ruxsat (looseObject), lekin bular SHART va turi aynan
const Vazifa = z.looseObject({ id: z.int().positive(), matn: z.string(), bajarildi: z.boolean(), teglar: z.array(z.string()), yaratildi: z.iso.datetime(), yangilandi: z.iso.datetime(), tartib: z.int(), versiya: z.int().positive() });
const Royxat = z.looseObject({ versiya: z.number(), vazifalar: z.array(Vazifa), sahifa: z.looseObject({ limit: z.int() }) });
const Problem = z.looseObject({ type: z.string(), title: z.string(), status: z.int(), detail: z.string().optional() });

test("iste'molchi shartnomasi: ro'yxat, yaratish, olish, PATCH, 404 va 422 javoblari frontend kutgan shaklda (+ Content-Type)", async () => {
  const yarat = await request(app).post("/v1/vazifalar").send({ matn: "Shartnoma #test" }).expect(201);
  const v = Vazifa.parse(yarat.body);
  Vazifa.parse((await request(app).get(`/v1/vazifalar/${String(v.id)}`).expect(200)).body);
  Royxat.parse((await request(app).get("/v1/vazifalar?limit=5").expect(200)).body);
  Vazifa.parse((await request(app).patch(`/v1/vazifalar/${String(v.id)}`).set("Content-Type", "application/merge-patch+json").send({ bajarildi: true }).expect(200)).body);
  const yoq = await request(app).get("/v1/vazifalar/99999").expect(404).expect("Content-Type", /application\/problem\+json/);
  Problem.parse(yoq.body);
  const notogri = await request(app).post("/v1/vazifalar").send({ matn: "" }).expect(422).expect("Content-Type", /application\/problem\+json/);
  assert.ok(Problem.extend({ xatolar: z.array(z.looseObject({ joy: z.string(), xabar: z.string() })) }).safeParse(notogri.body).success);
});
