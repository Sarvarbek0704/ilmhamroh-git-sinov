import { afterAll, test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { omborShartnomasi } from "./ombor-shartnoma.ts";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";
import { FaylOmbori } from "../src/vazifalar/fayl-ombor.ts";

const papkalar: string[] = [];
async function yangiPapka(): Promise<string> {
  const p = await mkdtemp(join(tmpdir(), "vazifalar-api-"));
  papkalar.push(p);
  return p;
}
afterAll(async () => {
  for (const p of papkalar) await rm(p, { recursive: true, force: true });
});

omborShartnomasi("xotira", () => Promise.resolve(new XotiraOmbori()));
omborShartnomasi("fayl", async () => FaylOmbori.och(join(await yangiPapka(), "ichki", "vazifalar.json")));

test("FaylOmbori: qayta ochilganda ma'lumot va id hisobi saqlangan; .tmp qolmaydi", async () => {
  const fayl = join(await yangiPapka(), "v.json");
  const a = await FaylOmbori.och(fayl);
  await a.yarat({ matn: "Non #uy" });
  await a.yarat({ matn: "Sut" });
  await a.ochir(2);
  const b = await FaylOmbori.och(fayl);
  assert.equal((await b.ol(1))?.matn, "Non #uy");
  assert.equal((await b.yarat({ matn: "Yangi" })).id, 3); // 2 qayta berilmaydi
  assert.deepEqual((await readdir(dirname(fayl))).filter((f) => f.endsWith(".tmp")), []);
  assert.equal((JSON.parse(await readFile(fayl, "utf8")) as { vazifalar: unknown[] }).vazifalar.length, 2);
});

test("FaylOmbori: buzilgan fayl — xato (jim bo'sh ro'yxat EMAS)", async () => {
  const fayl = join(await yangiPapka(), "buzuq.json");
  await writeFile(fayl, '{"vazifalar": [');
  await assert.rejects(FaylOmbori.och(fayl), SyntaxError);
  await writeFile(fayl, '{"boshqa": 1}');
  await assert.rejects(FaylOmbori.och(fayl), /tuzilmasi noto'g'ri/);
});

test("FaylOmbori: parallel 50 yozuv — hammasi saqlanadi (yozish navbati)", async () => {
  const fayl = join(await yangiPapka(), "parallel.json");
  const a = await FaylOmbori.och(fayl);
  await Promise.all(Array.from({ length: 50 }, (_, i) => a.yarat({ matn: `v${String(i)}` })));
  const b = await FaylOmbori.och(fayl);
  assert.equal(await b.soni({}), 50);
});
