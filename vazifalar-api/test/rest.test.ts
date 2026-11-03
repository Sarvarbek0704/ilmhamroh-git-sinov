import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import { ishgaTushir, jsonYubor } from "./yordamchi.ts";
import { sahifala } from "../src/vazifalar/royxat-mantiq.ts";
import type { Vazifa } from "../src/vazifalar/vazifa.ts";

type Royxat = { vazifalar: Partial<Vazifa>[]; sahifa: { limit: number; offset?: number; keyingi?: string | null; jami?: number } };

let asos = "";
let yop: () => Promise<boolean>;
beforeAll(async () => {
  ({ asos, yop } = await ishgaTushir());
  const matnlar = ["Non olish #uy", "Hisobot #ish", "Sut #uy #bozor", "Kitob o'qish #o'quv", "Yig'ilish #ish", "Olma #bozor"];
  for (const [i, matn] of matnlar.entries()) await fetch(`${asos}/v1/vazifalar`, jsonYubor("POST", { matn, bajarildi: i % 2 === 1 }));
});
afterAll(() => yop());

const ol = async (yol: string) => {
  const r = await fetch(asos + yol);
  return { holat: r.status, link: r.headers.get("link"), tana: (await r.json()) as Royxat };
};

test("PUT — to'liq almashtirish, bajarildi majburiy; PATCH — merge-patch+json ham qabul", async () => {
  assert.equal((await fetch(`${asos}/v1/vazifalar/1`, jsonYubor("PUT", { matn: "Non" }))).status, 422);
  const put = await fetch(`${asos}/v1/vazifalar/1`, jsonYubor("PUT", { matn: "Non olish #uy", bajarildi: false }));
  assert.equal(put.status, 200);
  const ikkinchi = (await (await fetch(`${asos}/v1/vazifalar/1`, jsonYubor("PUT", { matn: "Non olish #uy", bajarildi: false }))).json()) as Vazifa;
  assert.equal(ikkinchi.matn, "Non olish #uy"); // idempotent: holat bir xil
  const mp = await fetch(`${asos}/v1/vazifalar/1`, { method: "PATCH", headers: { "Content-Type": "application/merge-patch+json" }, body: '{"bajarildi":false}' });
  assert.equal(mp.status, 200);
  assert.equal((await fetch(`${asos}/v1/vazifalar/1`, { method: "PATCH", headers: { "Content-Type": "application/merge-patch+json" }, body: '{"matn":null}' })).status, 422);
});

test("filtr: bajarildi, teg (AND), q; noma'lum parametr — 400", async () => {
  assert.deepEqual((await ol("/v1/vazifalar?teg=uy")).tana.vazifalar.map((v) => v.id), [1, 3]);
  assert.deepEqual((await ol("/v1/vazifalar?teg=uy&teg=bozor")).tana.vazifalar.map((v) => v.id), [3]);
  assert.deepEqual((await ol("/v1/vazifalar?teg=%23ISH&bajarildi=true")).tana.vazifalar.map((v) => v.id), [2]);
  assert.deepEqual((await ol("/v1/vazifalar?q=KITOB")).tana.vazifalar.map((v) => v.id), [4]);
  assert.equal((await ol("/v1/vazifalar?bajarlidi=true")).holat, 400);
  assert.equal((await ol("/v1/vazifalar?q=a&q=b")).holat, 400);
});

test("saralash va maydon tanlash (id doim bor)", async () => {
  const r = await ol("/v1/vazifalar?sort=-bajarildi,matn&fields=matn");
  assert.deepEqual(r.tana.vazifalar.map((v) => v.id), [2, 4, 6, 1, 3, 5]);
  assert.deepEqual(Object.keys(r.tana.vazifalar[0] ?? {}), ["id", "matn"]);
  const bajarilganlar = r.tana.vazifalar.slice(0, 3).map((v) => v.matn);
  assert.deepEqual(bajarilganlar, ["Hisobot #ish", "Kitob o'qish #o'quv", "Olma #bozor"]);
  assert.equal((await ol("/v1/vazifalar?sort=parol")).holat, 400);
  assert.equal((await ol("/v1/vazifalar?fields=id,parol")).holat, 400);
});

test("offset sahifalash: Link rel=next, jami", async () => {
  const r = await ol("/v1/vazifalar?limit=4&offset=0&jami=true");
  assert.equal(r.tana.vazifalar.length, 4);
  assert.deepEqual(r.tana.sahifa, { limit: 4, offset: 0, jami: 6 });
  assert.equal(r.link, "</v1/vazifalar?limit=4&jami=true&offset=4>; rel=\"next\"");
  const r2 = await ol("/v1/vazifalar?limit=4&jami=true&offset=4");
  assert.equal(r2.tana.vazifalar.length, 2);
  assert.equal(r2.link, null);
});

test("kursor sahifalash: hammasi bir martadan; boshqa saralash bilan kursor — 400", async () => {
  const korildi: number[] = [];
  let yol = "/v1/vazifalar?limit=2&sort=-yaratildi";
  for (let i = 0; i < 10; i++) {
    const r = await ol(yol);
    korildi.push(...r.tana.vazifalar.map((v) => v.id ?? 0));
    if (r.tana.sahifa.keyingi === null) break;
    yol = `/v1/vazifalar?limit=2&sort=-yaratildi&cursor=${String(r.tana.sahifa.keyingi)}`;
  }
  assert.deepEqual([...korildi].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  const birinchi = await ol("/v1/vazifalar?limit=2&sort=-yaratildi");
  const k = String(birinchi.tana.sahifa.keyingi);
  assert.equal((await ol(`/v1/vazifalar?limit=2&sort=matn&cursor=${k}`)).holat, 400);
  assert.equal((await ol(`/v1/vazifalar?limit=2&sort=-yaratildi&cursor=buzuq`)).holat, 400);
  assert.equal((await ol(`/v1/vazifalar?offset=2&cursor=${k}`)).holat, 400);
});

test("/teglar — ko'pidan kamiga", async () => {
  const r = await fetch(`${asos}/v1/teglar`);
  const { teglar } = (await r.json()) as { teglar: { teg: string; soni: number }[] };
  assert.deepEqual(teglar.slice(0, 3), [{ teg: "bozor", soni: 2 }, { teg: "ish", soni: 2 }, { teg: "uy", soni: 2 }]);
});

test("sahifala: kursor qatori o'chirilsa ham keyingisidan davom etadi; offset esa siljiydi", () => {
  const v = (id: number): Vazifa => ({ id, matn: `v${String(id)}`, bajarildi: false, teglar: [], yaratildi: "2026-10-24T00:00:00.000Z", yangilandi: "2026-10-24T00:00:00.000Z", tartib: id, versiya: 1 });
  const hammasi = [1, 2, 3, 4, 5].map(v);
  const s1 = sahifala(hammasi, { filtr: {}, saralash: [], limit: 2, sahifa: { tur: "kursor" } });
  assert.deepEqual(s1.keyingi, [2, 2]); // sukut kalitlari: tartib, id
  const qolgan = hammasi.filter((x) => x.id !== 2);
  const s2 = sahifala(qolgan, { filtr: {}, saralash: [], limit: 2, sahifa: { tur: "kursor", keyin: s1.keyingi ?? [] } });
  assert.deepEqual(s2.vazifalar.map((x) => x.id), [3, 4]);
  const o2 = sahifala(qolgan, { filtr: {}, saralash: [], limit: 2, sahifa: { tur: "offset", offset: 2 } });
  assert.deepEqual(o2.vazifalar.map((x) => x.id), [4, 5]); // 3 o'tkazib yuborildi!
});
