import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import { request } from "node:http";
import { ishgaTushir, jsonYubor, xomSorov } from "./yordamchi.ts";
import { teglariniOl } from "../src/vazifalar/vazifa.ts";

let asos = "";
let yop: () => Promise<boolean>;
beforeAll(async () => ({ asos, yop } = await ishgaTushir()));
afterAll(() => yop());

test("CRUD: yaratish → o'qish → o'zgartirish → o'chirish", async () => {
  const r1 = await fetch(`${asos}/v1/vazifalar`, jsonYubor("POST", { matn: "  Non olish #uy #Bozor " }));
  assert.equal(r1.status, 201);
  const v = (await r1.json()) as { id: number; matn: string; teglar: string[]; bajarildi: boolean };
  assert.equal(r1.headers.get("location"), `/v1/vazifalar/${String(v.id)}`);
  assert.equal(v.matn, "Non olish #uy #Bozor");
  assert.deepEqual(v.teglar, ["uy", "bozor"]);
  assert.equal(v.bajarildi, false);

  const r2 = await fetch(`${asos}/v1/vazifalar/${String(v.id)}`, jsonYubor("PATCH", { bajarildi: true }));
  assert.equal(r2.status, 200);
  assert.equal(((await r2.json()) as { bajarildi: boolean }).bajarildi, true);

  const r3 = await fetch(`${asos}/v1/vazifalar?bajarildi=true`);
  assert.equal(((await r3.json()) as { vazifalar: unknown[] }).vazifalar.length, 1);

  const r4 = await fetch(`${asos}/v1/vazifalar/${String(v.id)}`, { method: "DELETE" });
  assert.equal(r4.status, 204);
  assert.equal((await fetch(`${asos}/v1/vazifalar/${String(v.id)}`)).status, 404);
});

test("xatolar: 400 JSON, 415, 422, 405 + Allow, 404", async () => {
  const xom = await fetch(`${asos}/v1/vazifalar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{matn:" });
  assert.equal(xom.status, 400);
  assert.equal(xom.headers.get("content-type"), "application/problem+json; charset=utf-8");
  assert.deepEqual(await xom.json(), { type: "about:blank", title: "Noto'g'ri so'rov", status: 400, detail: "Tana yaroqli JSON emas", instance: "/v1/vazifalar", sorovId: xom.headers.get("x-request-id") });
  const matnli = await fetch(`${asos}/v1/vazifalar`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "salom" });
  assert.equal(matnli.status, 415);
  assert.equal((await fetch(`${asos}/v1/vazifalar`, jsonYubor("POST", { matn: "" }))).status, 422);
  assert.equal((await fetch(`${asos}/v1/vazifalar`, jsonYubor("POST", { matn: "a", ortiqcha: 1 }))).status, 422);
  const put = await fetch(`${asos}/v1/vazifalar`, { method: "DELETE" });
  assert.equal(put.status, 405);
  assert.equal(put.headers.get("allow"), "GET, HEAD, POST, PUT");
  assert.equal((await fetch(`${asos}/v1/vazifalar/1`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${asos}/yoq`)).status, 404);
  assert.equal((await fetch(`${asos}/v1/vazifalar?bajarildi=ha`)).status, 400);
  assert.equal((await fetch(`${asos}/v1/vazifalar/abc`)).status, 400);
});

test("413: Content-Length bilan va chunked (uzunliksiz) katta tana", async () => {
  const katta = JSON.stringify({ matn: "x".repeat(20_000) });
  const r = await fetch(`${asos}/v1/vazifalar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: katta });
  assert.equal(r.status, 413);
  // chunked: Content-Length yo'q — limit o'qish paytida tekshiriladi
  const holat = await new Promise<number>((resolve, reject) => {
    const so = request(`${asos}/v1/vazifalar`, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    so.on("error", reject);
    for (let i = 0; i < 20; i++) so.write("x".repeat(1024));
    so.end();
  });
  assert.equal(holat, 413);
});

test("statik (express.static): index.html, ETag → 304, Range → 206, traversal → 404", async () => {
  const r = await xomSorov(`${asos}/`);
  assert.equal(r.holat, 200);
  assert.match(String(r.sarlavhalar["content-type"]), /text\/html/);
  const etag = String(r.sarlavhalar.etag);
  assert.equal((await xomSorov(`${asos}/`, { sarlavhalar: { "If-None-Match": etag } })).holat, 304);
  const q = await xomSorov(`${asos}/index.html`, { sarlavhalar: { Range: "bytes=0-14" } });
  assert.equal(q.holat, 206);
  assert.equal(q.tana, "<!doctype html>");
  assert.equal((await xomSorov(`${asos}/index.html`, { sarlavhalar: { Range: "bytes=99999-" } })).holat, 416);
  // node:http yo'lni normallashtirmaydi — server o'zi himoyalanishi kerak
  assert.equal((await xomSorov(`${asos}/../package.json`)).holat, 404);
  assert.equal((await xomSorov(`${asos}/..%2fpackage.json`)).holat, 404);
});

test("teglariniOl: frontend qoidasi", () => {
  assert.deepEqual(teglariniOl("Non#uy ##x #o'quv #g‘isht #UY #uy"), ["o'quv", "g‘isht", "uy"]);
});
