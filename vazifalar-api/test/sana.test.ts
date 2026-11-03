import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import { keyingiKun, kunBoshiUtc, siljish } from "../src/umumiy/sana.ts";
import { ishgaTushir } from "../src/ishga-tushir.ts";
import { yop } from "../src/yopish.ts";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";

test("Toshkent kuni → UTC: 24-oktabr 00:00 (UTC+5) = 23-oktabr 19:00Z", () => {
  assert.equal(siljish("Asia/Tashkent", new Date("2026-10-24T00:00:00Z")), 300);
  assert.equal(kunBoshiUtc("2026-10-24", "Asia/Tashkent"), "2026-10-23T19:00:00.000Z");
  assert.equal(kunBoshiUtc("2026-10-24", "UTC"), "2026-10-24T00:00:00.000Z");
  assert.equal(keyingiKun("2026-12-31"), "2027-01-01");
});

test("DST bor mintaqa: Nyu-York yoz (UTC-4) va qish (UTC-5)", () => {
  assert.equal(kunBoshiUtc("2026-07-01", "America/New_York"), "2026-07-01T04:00:00.000Z");
  assert.equal(kunBoshiUtc("2026-12-01", "America/New_York"), "2026-12-01T05:00:00.000Z");
});

let asos = "";
let toxta: () => Promise<boolean>;
beforeAll(async () => {
  // Soxta soat: UTC 23-okt 18:30 (Toshkentda 23:30) va 19:30 (Toshkentda 24-okt 00:30)
  const vaqtlar = ["2026-10-23T18:30:00.000Z", "2026-10-23T19:30:00.000Z"];
  const ombor = new XotiraOmbori(() => new Date(vaqtlar.shift() ?? "2026-10-25T00:00:00.000Z"));
  await ombor.yarat({ matn: "kech" });
  await ombor.yarat({ matn: "yarim tundan keyin" });
  const { server, manzil } = await ishgaTushir({ port: 0, bogliqliklar: { ombor, tz: "Asia/Tashkent" } });
  asos = manzil;
  toxta = () => yop(server, 1000);
});
afterAll(() => toxta());

test("?dan=&gacha= — Toshkent kalendar kuni bo'yicha (UTC sanasi bo'yicha emas)", async () => {
  const ol = async (q: string) => ((await (await fetch(`${asos}/v1/vazifalar?${q}&fields=matn`)).json()) as { vazifalar: { matn: string }[] }).vazifalar.map((v) => v.matn);
  assert.deepEqual(await ol("dan=2026-10-24&gacha=2026-10-24"), ["yarim tundan keyin"]);
  assert.deepEqual(await ol("gacha=2026-10-23"), ["kech"]);
  assert.equal((await fetch(`${asos}/v1/vazifalar?dan=2026-02-30`)).status, 400);
});
