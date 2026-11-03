import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import { ishgaTushir as ishga } from "../src/ishga-tushir.ts";
import { yop } from "../src/yopish.ts";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";
import { jsonYubor, xotiraLogi } from "./yordamchi.ts";
import type { Problem } from "../src/umumiy/problem.ts";

// Fake ombor: haqiqiy xotira ombori, lekin ol() kutilmagan xato tashlaydi (DB uzildi kabi)
class BuzuqOmbor extends XotiraOmbori {
  override ol(): Promise<undefined> {
    return Promise.reject(new Error("ulanish uzildi: parol=maxfiy"));
  }
}

let asos = "";
let toxta: () => Promise<boolean>;
const { log, qatorlar } = xotiraLogi();
beforeAll(async () => {
  const { server, manzil } = await ishga({ port: 0, bogliqliklar: { ombor: new BuzuqOmbor(), log } });
  asos = manzil;
  toxta = () => yop(server, 1000);
});
afterAll(() => toxta());

test("Problem Details: domen xatosi (422) — type, title, detail, kod, xatolar, instance", async () => {
  const r = await fetch(`${asos}/v1/vazifalar`, jsonYubor("POST", { matn: " " }));
  assert.equal(r.status, 422);
  assert.equal(r.headers.get("content-type"), "application/problem+json; charset=utf-8");
  const p = (await r.json()) as Problem;
  assert.deepEqual(p, {
    type: "https://vazifalar-api.example/xatolar/validatsiya",
    title: "So'rov ma'lumoti noto'g'ri",
    status: 422,
    detail: "matn 1–100 belgi bo'lishi kerak",
    instance: "/v1/vazifalar",
    kod: "validatsiya",
    xatolar: [{ joy: "body.matn", xabar: "matn 1–100 belgi bo'lishi kerak" }],
    sorovId: r.headers.get("x-request-id"),
  });
});

test("Problem Details: 404 marshrut (about:blank), 405 Allow bilan, 415", async () => {
  const yoq = (await (await fetch(`${asos}/yoq?x=1`)).json()) as Problem;
  assert.equal(yoq.type, "about:blank");
  assert.equal(yoq.title, "Topilmadi"); // 31: mahalliylashtirilgan (RFC 9457 §4.2.1 ruxsat beradi)
  assert.equal(yoq.instance, "/yoq?x=1");
  const r = await fetch(`${asos}/v1/teglar`, { method: "DELETE" });
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "GET, HEAD");
  assert.equal(((await r.json()) as Problem).title, "Metod ruxsat etilmagan");
  const t = await fetch(`${asos}/v1/vazifalar`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" });
  assert.equal(((await t.json()) as Problem).status, 415);
});

test("500: ichki xabar mijozga chiqmaydi, logda sorovId bilan bor", async () => {
  const r = await fetch(`${asos}/v1/vazifalar/1`, { headers: { "X-Request-Id": "test-500-abcdef" } });
  assert.equal(r.status, 500);
  const matn = await r.text();
  assert.doesNotMatch(matn, /parol|maxfiy|ulanish uzildi|BuzuqOmbor|\.ts:\d+/);
  assert.equal((JSON.parse(matn) as Problem).sorovId, "test-500-abcdef");
  // logda — to'liq xato (stack bilan) va o'sha sorovId
  const q = qatorlar.find((x) => x.msg === "kutilmagan xato");
  assert.ok(q);
  assert.equal(q.sorovId, "test-500-abcdef");
  assert.equal(q.daraja, "error");
  assert.match(String((q.err as { stack?: string } | undefined)?.stack), /ulanish uzildi/);
});
