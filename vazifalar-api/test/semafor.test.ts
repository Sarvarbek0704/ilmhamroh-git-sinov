// semafor.test.ts — #29: Semafor — bir vaqtda maks N, navbat chegarasi oshsa BandXatosi (503), xatoda ham joy bo'shaydi
import { test } from "vitest";
import assert from "node:assert/strict";
import { setTimeout as kut } from "node:timers/promises";
import { BandXatosi, Semafor } from "../src/umumiy/semafor.ts";
import { HASH_SEMAFORI } from "../src/auth/parol.ts";

test("maks 2 parallel, navbat 3: 5 tasi bajariladi, 6-si darhol 503; bir vaqtda hech qachon 2 dan ko'p emas", async () => {
  const s = new Semafor(2, 3);
  let bir = 0, eng = 0;
  const ish = () => s.bajar(async () => { bir++; eng = Math.max(eng, bir); await kut(20); bir--; return "ok"; });
  const vazifalar = Array.from({ length: 5 }, ish);
  await assert.rejects(ish(), (x: unknown) => x instanceof BandXatosi && x.holat === 503 && x.httpSarlavhalar["Retry-After"] === "1");
  assert.deepEqual(await Promise.all(vazifalar), ["ok", "ok", "ok", "ok", "ok"]);
  assert.equal(eng, 2);
  assert.deepEqual(s.holat, { band: 0, navbat: 0 });
});

test("ish xato bersa ham joy bo'shaydi; parol hash semafori — 4 / 64", async () => {
  const s = new Semafor(1, 1);
  await assert.rejects(s.bajar(() => Promise.reject(new Error("x"))));
  assert.equal(await s.bajar(() => Promise.resolve(1)), 1);
  assert.deepEqual(HASH_SEMAFORI.holat, { band: 0, navbat: 0 });
});
