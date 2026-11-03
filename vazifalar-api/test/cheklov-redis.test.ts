// cheklov-redis.test.ts — 31-qism #30: RedisCheklagich — Pg cheklagichi bilan bir xil shartnoma (qat'iy oyna, limit, tiklanish, tozalash). TEST_REDIS_URL kerak.
import { afterAll, test } from "vitest";
import assert from "node:assert/strict";
import { createClient } from "redis";
import { RedisCheklagich } from "../src/umumiy/cheklov.ts";

const URL = process.env["TEST_REDIS_URL"];
if (URL === undefined) {
  test.skip("RedisCheklagich — TEST_REDIS_URL yo'q", () => {});
} else {
  const r = createClient({ url: URL });
  await r.connect();
  afterAll(() => r.quit());
  test("limit 3: 4-chi rad; tiklanish 1..60 s; oyna tugagach yana 1 dan; tozala() — darhol", async () => {
    const c = new RedisCheklagich(r, `vz:test:cheklov:${String(process.pid)}:`);
    await c.tozala("k");
    const n = [];
    for (let i = 0; i < 4; i++) n.push(await c.ol("k", 3, 60_000));
    assert.deepEqual(n.map((x) => [x.son, x.ruxsat, x.qoldi]), [[1, true, 2], [2, true, 1], [3, true, 0], [4, false, 0]]);
    assert.ok((n[3]?.tiklanishS ?? 0) >= 1 && (n[3]?.tiklanishS ?? 99) <= 60);
    await c.tozala("k");
    assert.equal((await c.ol("k", 3, 60_000)).son, 1);
    const q = await c.ol("q", 1, 150);
    await new Promise((ok) => setTimeout(ok, 250));
    assert.equal((await c.ol("q", 1, 150)).son, 1); // oyna tugadi — PEXPIRE NX bilan kalit o'chdi
    assert.equal(q.son, 1);
    await c.tozala("k");
  });
}
