// kesh-ombor.test.ts — holat 58: KeshliOmbor (Redis kesh) — SHARTNOMA testlari (kesh invalidatsiyasi to'g'ri bo'lsa, xotira ombori bilan
// bir xil natija), hit/miss, yozuvdan keyin eskirgan javob yo'qligi, Redis o'chsa ham ishlashi. Redis: TEST_REDIS_URL (sukut 127.0.0.1:6380,
// har test o'z prefiksida — egasi id tasodifiy). Redis yo'q — SKIP.
import { afterAll, describe, test } from "vitest";
import assert from "node:assert/strict";
import { createClient } from "redis";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";
import { KeshliOmbor } from "../src/vazifalar/kesh-ombor.ts";
import { omborShartnomasi } from "./ombor-shartnoma.ts";
import type { RoyxatSorovi } from "../src/vazifalar/ombor.ts";

/** royxat() necha marta ichki omborga yetib kelganini sanaydi */
class SanovchiOmbor extends XotiraOmbori {
  chaqiruv = 0;
  override royxat(s: RoyxatSorovi): ReturnType<XotiraOmbori["royxat"]> {
    this.chaqiruv++;
    return super.royxat(s);
  }
}

const URL = process.env["TEST_REDIS_URL"] ?? "redis://127.0.0.1:6380";
const redis = createClient({ url: URL, disableOfflineQueue: true, socket: { connectTimeout: 1000, reconnectStrategy: false } });
redis.on("error", () => {});
const bor = await redis.connect().then(() => true, () => false);

if (!bor) {
  test.skip(`KeshliOmbor — Redis yo'q (${URL})`, () => {});
} else {
  // test egalari 9e6 dan boshlanadi — ilova kalitlariga (egasi 1…) aralashmaydi; oxirida o'chiriladi
  let egasi = 9_000_000 + Math.floor(Math.random() * 100_000);
  afterAll(async () => {
    for await (const k of redis.scanIterator({ MATCH: "vz:9*", COUNT: 500 })) if (k.length > 0) await redis.del(k);
    redis.destroy();
  });
  const hammasi: RoyxatSorovi = { filtr: {}, saralash: [], limit: 10, sahifa: { tur: "kursor" } };

  omborShartnomasi("xotira + Redis kesh", () => Promise.resolve(new KeshliOmbor(new XotiraOmbori(), redis, ++egasi, { ttlS: 60 })));

  describe("KeshliOmbor: kesh xulqi", () => {
    test("ikkinchi o'qish keshdan (ichki omborga bormaydi); yozuvdan keyin darhol yangi natija", async () => {
      const sanovchi = new SanovchiOmbor();
      const o = new KeshliOmbor(sanovchi, redis, ++egasi, { ttlS: 60 });
      await o.yarat({ matn: "Non" });
      assert.equal((await o.royxat(hammasi)).vazifalar.length, 1);
      assert.equal((await o.royxat(hammasi)).vazifalar.length, 1);
      assert.equal(sanovchi.chaqiruv, 1);
      assert.deepEqual(o.hisob, { hit: 1, miss: 1, xato: 0 });
      await o.yarat({ matn: "Sut" });
      assert.equal((await o.royxat(hammasi)).vazifalar.length, 2); // avlod oshdi — eski kesh ishlatilmadi
      assert.equal(sanovchi.chaqiruv, 2);
    });

    test("konflikt/topilmadi — avlod OSHMAYDI (kesh behuda tozalanmaydi); topilmadi (undefined) ham keshlanadi", async () => {
      const o = new KeshliOmbor(new XotiraOmbori(), redis, ++egasi, { ttlS: 60 });
      await o.yarat({ matn: "a" });
      const avlod = await redis.get(`vz:${String(egasi)}:avlod`);
      assert.equal((await o.yangila(1, { matn: "b" }, { versiya: 99 })).tur, "konflikt");
      assert.equal((await o.ochir(42)).tur, "topilmadi");
      assert.equal(await redis.get(`vz:${String(egasi)}:avlod`), avlod);
      assert.equal(await o.ol(42), undefined);
      assert.equal(await o.ol(42), undefined);
      assert.equal(o.hisob.hit, 1);
    });

    test("TTL + jitter: kalit muddati 60–65 s", async () => {
      const o = new KeshliOmbor(new XotiraOmbori(), redis, ++egasi, { ttlS: 60 });
      await o.teglar();
      const kalitlar: string[] = [];
      for await (const k of redis.scanIterator({ MATCH: `vz:${String(egasi)}:a*`, COUNT: 100 })) kalitlar.push(...(Array.isArray(k) ? k : [k]));
      assert.equal(kalitlar.length, 1);
      const ttl = await redis.ttl(kalitlar[0] ?? "");
      assert.ok(ttl >= 59 && ttl <= 66, `ttl ${String(ttl)}`);
    });

    test("Redis ishlamasa — ombor to'g'ridan ishlaydi (xato log'ga), so'rov yiqilmaydi", async () => {
      const ulanmagan = createClient({ url: "redis://127.0.0.1:6399", disableOfflineQueue: true, socket: { reconnectStrategy: false } });
      ulanmagan.on("error", () => {});
      const ogoh: string[] = [];
      const o = new KeshliOmbor(new XotiraOmbori(), ulanmagan, ++egasi, { ttlS: 60, log: { warn: (_o, x) => { ogoh.push(x); } } });
      await o.yarat({ matn: "Redis'siz" });
      assert.equal((await o.royxat(hammasi)).vazifalar[0]?.matn, "Redis'siz");
      assert.ok(o.hisob.xato >= 2);
      assert.ok(ogoh.some((x) => x.startsWith("kesh: Redis xatosi")));
    });
  });
}
