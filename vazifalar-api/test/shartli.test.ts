import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import { ishgaTushir, jsonYubor, xomSorov } from "./yordamchi.ts";

let asos = "";
let yop: () => Promise<boolean>;
beforeAll(async () => ({ asos, yop } = await ishgaTushir()));
afterAll(() => yop());

const patch = (id: number, tana: unknown, ifMatch?: string) =>
  fetch(`${asos}/v1/vazifalar/${String(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(ifMatch === undefined ? {} : { "If-Match": ifMatch }) },
    body: JSON.stringify(tana),
  });

test("ETag = versiya; If-None-Match → 304 (node:http); Cache-Control private, no-cache", async () => {
  const r = await fetch(`${asos}/v1/vazifalar`, jsonYubor("POST", { matn: "Non olish" }));
  assert.equal(r.headers.get("etag"), '"1"');
  const g = await xomSorov(`${asos}/v1/vazifalar/1`);
  assert.equal(g.sarlavhalar.etag, '"1"');
  assert.equal(g.sarlavhalar["cache-control"], "private, no-cache");
  assert.ok(g.sarlavhalar["last-modified"]);
  const yana = await xomSorov(`${asos}/v1/vazifalar/1`, { sarlavhalar: { "If-None-Match": '"1"' } });
  assert.equal(yana.holat, 304);
  assert.equal(yana.tana, "");
  // ro'yxat — Express'ning W/ ETag'i bilan ham 304
  const ro = await xomSorov(`${asos}/v1/vazifalar`);
  assert.equal((await xomSorov(`${asos}/v1/vazifalar`, { sarlavhalar: { "If-None-Match": String(ro.sarlavhalar.etag) } })).holat, 304);
});

test("If-Match: eski versiya → 412 + joriy ETag; to'g'risi → 200, versiya oshadi; W/ → 412; If-Match'siz — oddiy yozuv", async () => {
  await fetch(`${asos}/v1/vazifalar`, jsonYubor("POST", { matn: "Hisobot" }));
  const a = await patch(2, { bajarildi: true }, '"1"');
  assert.equal(a.status, 200);
  assert.equal(a.headers.get("etag"), '"2"');
  const b = await patch(2, { matn: "Hisobot (eski nusxadan)" }, '"1"'); // ikkinchi mijoz hali 1-versiyani ko'rgan
  assert.equal(b.status, 412);
  assert.equal(b.headers.get("etag"), '"2"');
  assert.equal(((await b.json()) as { kod: string }).kod, "versiya-mos-emas");
  assert.equal((await patch(2, { bajarildi: false }, 'W/"2"')).status, 412);
  assert.equal((await patch(2, { bajarildi: false }, "*")).status, 200);
  assert.equal((await patch(2, { bajarildi: true })).status, 200);
  const o = await fetch(`${asos}/v1/vazifalar/2`, { method: "DELETE", headers: { "If-Match": '"1"' } });
  assert.equal(o.status, 412);
  assert.equal((await fetch(`${asos}/v1/vazifalar/2`, { method: "DELETE", headers: { "If-Match": '"4"' } })).status, 204);
});

test("versiyasiz eski yo'l ishlaydi, lekin Deprecation, Sunset va voris havolasi bilan", async () => {
  const r = await fetch(`${asos}/vazifalar/1`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("deprecation"), "@1792800000");
  assert.equal(r.headers.get("sunset"), "Sun, 24 Jan 2027 00:00:00 GMT");
  assert.equal(r.headers.get("link"), '</v1/vazifalar/1>; rel="successor-version"');
  const yangi = await fetch(`${asos}/v1/vazifalar/1`);
  assert.equal(yangi.headers.get("deprecation"), null);
});
