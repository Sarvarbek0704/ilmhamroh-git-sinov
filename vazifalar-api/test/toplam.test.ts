import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import { ishgaTushir, jsonYubor } from "./yordamchi.ts";
import type { Vazifa } from "../src/vazifalar/vazifa.ts";

let asos = "";
let yop: () => Promise<boolean>;
beforeAll(async () => ({ asos, yop } = await ishgaTushir()));
afterAll(() => yop());

type Royxat = { versiya: number; vazifalar: Vazifa[] };

test("PUT /v1/vazifalar — butun to'plam: id saqlanadi, yangisiga id beriladi, versiya oshadi; xato bo'lsa hech narsa o'zgarmaydi", async () => {
  await fetch(`${asos}/v1/vazifalar`, jsonYubor("POST", { matn: "Eski" }));
  const oldin = (await (await fetch(`${asos}/v1/vazifalar`)).json()) as Royxat;
  const r = await fetch(`${asos}/v1/vazifalar`, jsonYubor("PUT", { vazifalar: [{ id: 7, matn: "Import #uy", bajarildi: false }, { matn: "Yangi", bajarildi: true }, { id: 7, matn: "Takror id", bajarildi: false }] }));
  assert.equal(r.status, 200);
  const j = (await r.json()) as Royxat;
  assert.deepEqual(j.vazifalar.map((v) => [v.id, v.matn]), [[7, "Import #uy"], [8, "Yangi"], [9, "Takror id"]]);
  assert.ok(j.versiya > oldin.versiya);
  const xato = await fetch(`${asos}/v1/vazifalar`, jsonYubor("PUT", { vazifalar: [{ matn: "ok", bajarildi: false }, { matn: "", bajarildi: false }, { id: -1, matn: "x", bajarildi: true }] }));
  assert.equal(xato.status, 422);
  const p = (await xato.json()) as { xatolar: { joy: string }[] };
  assert.deepEqual(p.xatolar.map((x) => x.joy), ["body.vazifalar.1.matn", "body.vazifalar.2.id"]);
  const keyin = (await (await fetch(`${asos}/v1/vazifalar`)).json()) as Royxat;
  assert.equal(keyin.vazifalar.length, 3);
  assert.equal(keyin.versiya, j.versiya);
});

test("POST /v1/vazifalar/toplam — qisman muvaffaqiyat 207, hammasi yaroqli — 201", async () => {
  const r = await fetch(`${asos}/v1/vazifalar/toplam`, jsonYubor("POST", { vazifalar: [{ matn: "A" }, { matn: "" }, { matn: "B", bajarildi: true }] }));
  assert.equal(r.status, 207);
  const { natijalar } = (await r.json()) as { natijalar: { indeks: number; holat: number }[] };
  assert.deepEqual(natijalar.map((n) => [n.indeks, n.holat]), [[0, 201], [1, 422], [2, 201]]);
  assert.equal((await fetch(`${asos}/v1/vazifalar/toplam`, jsonYubor("POST", { vazifalar: [{ matn: "C" }] }))).status, 201);
  assert.equal((await fetch(`${asos}/v1/vazifalar/toplam`, jsonYubor("POST", { vazifalar: [] }))).status, 422);
});

test("eksport: 202 + Location + Retry-After → holat so'rab turiladi → CSV fayl (qo'shtirnoq qochiriladi)", async () => {
  await fetch(`${asos}/v1/vazifalar`, jsonYubor("POST", { matn: 'Non, sut va "qatiq" #uy' }));
  const r = await fetch(`${asos}/v1/eksportlar`, { method: "POST" });
  assert.equal(r.status, 202);
  assert.equal(r.headers.get("retry-after"), "1");
  const joy = r.headers.get("location") ?? "";
  assert.match(joy, /^\/v1\/eksportlar\/[0-9a-f-]{36}$/);
  let holat: { holat: string; fayl?: string; jami: number } = { holat: "kutilmoqda", jami: 0 };
  for (let i = 0; i < 50 && holat.holat !== "tayyor"; i++) {
    holat = (await (await fetch(asos + joy)).json()) as typeof holat;
    if (holat.holat !== "tayyor") await new Promise((ok) => setTimeout(ok, 10));
  }
  assert.equal(holat.holat, "tayyor");
  const f = await fetch(asos + String(holat.fayl));
  assert.equal(f.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.match(String(f.headers.get("content-disposition")), /^attachment; filename=vazifalar-\d{4}-\d{2}-\d{2}\.csv$/);
  const qatorlar = (await f.text()).trimEnd().split("\r\n");
  assert.equal(qatorlar.length, holat.jami + 1);
  assert.ok(qatorlar.some((q) => q.includes('"Non, sut va ""qatiq"" #uy"')));
  assert.equal((await fetch(`${asos}/v1/eksportlar/yoq`)).status, 404);
});
