import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import { ishgaTushir as ishga } from "../src/ishga-tushir.ts";
import { yop } from "../src/yopish.ts";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";
import { XotiraIdempotentlikOmbori } from "../src/umumiy/idempotentlik.ts";
import type { Vazifa, YangiVazifa } from "../src/vazifalar/vazifa.ts";

// Sekin ombor: yaratish 150 ms — parallel so'rovlar "jarayonda" holatiga tushsin
class SekinOmbor extends XotiraOmbori {
  override async yarat(yangi: YangiVazifa): Promise<Vazifa> {
    await new Promise((r) => setTimeout(r, 150));
    return super.yarat(yangi);
  }
}

let asos = "";
let toxta: () => Promise<boolean>;
let soat = 0;
beforeAll(async () => {
  const { server, manzil } = await ishga({
    port: 0,
    bogliqliklar: { ombor: new SekinOmbor(), idempotentlikOmbori: new XotiraIdempotentlikOmbori(() => soat) },
  });
  asos = manzil;
  toxta = () => yop(server, 1000);
});
afterAll(() => toxta());

const post = (tana: unknown, kalit?: string) =>
  fetch(`${asos}/v1/vazifalar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(kalit === undefined ? {} : { "Idempotency-Key": kalit }) },
    body: JSON.stringify(tana),
  });
const soni = async () => ((await (await fetch(`${asos}/v1/vazifalar?jami=true&limit=1`)).json()) as { sahifa: { jami: number } }).sahifa.jami;

test("takroriy POST bir xil kalit bilan — bitta vazifa, ikkinchisi saqlangan javob (Idempotency-Replayed)", async () => {
  const oldin = await soni();
  const r1 = await post({ matn: "Non olish", bajarildi: false }, "kalit-0001");
  const r2 = await post({ bajarildi: false, matn: "Non olish" }, "kalit-0001"); // kalitlar tartibi boshqa — iz bir xil
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  assert.equal(r2.headers.get("idempotency-replayed"), "true");
  assert.equal(r2.headers.get("location"), r1.headers.get("location"));
  assert.deepEqual(await r2.json(), await r1.json());
  assert.equal(await soni(), oldin + 1);
});

test("kalitsiz takror — ikki vazifa; boshqa tana bilan kalit — 422; yaroqsiz kalit — 400", async () => {
  const oldin = await soni();
  await post({ matn: "Sut" });
  await post({ matn: "Sut" });
  assert.equal(await soni(), oldin + 2);
  await post({ matn: "Olma" }, "kalit-0002");
  const r = await post({ matn: "Nok" }, "kalit-0002");
  assert.equal(r.status, 422);
  assert.equal(((await r.json()) as { kod: string }).kod, "idempotentlik-boshqa-tana");
  assert.equal((await post({ matn: "x" }, "bo'sh joy bor")).status, 400);
});

test("parallel: bir xil kalit — biri 201, ikkinchisi 409 + Retry-After", async () => {
  const [a, b] = await Promise.all([post({ matn: "Parallel" }, "kalit-0003"), post({ matn: "Parallel" }, "kalit-0003")]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const ikkinchi = a.status === 409 ? a : b;
  assert.equal(ikkinchi.headers.get("retry-after"), "1");
});

test("xato javobi (422) ham saqlanadi; muddati o'tgach kalit qayta ishlaydi", async () => {
  const r1 = await post({ matn: "" }, "kalit-0004");
  assert.equal(r1.status, 422);
  const r2 = await post({ matn: "" }, "kalit-0004");
  assert.equal(r2.headers.get("idempotency-replayed"), "true");
  soat += 24 * 60 * 60 * 1000 + 1;
  const r3 = await post({ matn: "" }, "kalit-0004");
  assert.equal(r3.headers.get("idempotency-replayed"), null);
});

test("regressiya (t24): mijoz kutmay uzilsa ham qayta urinish ikkinchi vazifa yaratmaydi", async () => {
  const oldin = await soni();
  const tana = JSON.stringify({ matn: "To'lov #muhim" });
  const sarlavha = { "Content-Type": "application/json", "Idempotency-Key": "kalit-0005" };
  await assert.rejects(fetch(`${asos}/v1/vazifalar`, { method: "POST", headers: sarlavha, body: tana, signal: AbortSignal.timeout(30) }), { name: "TimeoutError" });
  const r2 = await fetch(`${asos}/v1/vazifalar`, { method: "POST", headers: sarlavha, body: tana });
  assert.equal(r2.status, 409); // birinchisi hali bajarilmoqda (150 ms)
  await new Promise((r) => setTimeout(r, 200));
  const r3 = await fetch(`${asos}/v1/vazifalar`, { method: "POST", headers: sarlavha, body: tana });
  assert.equal(r3.status, 201);
  assert.equal(r3.headers.get("idempotency-replayed"), "true");
  assert.equal(await soni(), oldin + 1);
});
