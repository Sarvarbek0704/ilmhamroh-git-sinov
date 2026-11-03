// fayl.test.ts — 29-qism B (holat 06): vazifa ilovalari — haqiqiy Postgres (auth test bazasi) + MinIO (S3_ENDPOINT). Bo'lmasa SKIP.
import { afterAll, beforeAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { FaylOmbori } from "../src/fayl/s3.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";

const S3 = process.env["S3_ENDPOINT"];
const baza = await authBaza("fayl");
if (typeof baza === "string" || S3 === undefined) {
  test.skip(`fayl ilovalari (Postgres + MinIO) — ${typeof baza === "string" ? baza : "S3_ENDPOINT yo'q"}`, () => {});
} else {
  const pool = baza;
  const ombor = new FaylOmbori({ endpoint: S3, region: "us-east-1", kalit: process.env["S3_KALIT"] ?? "", sir: process.env["S3_SIR"] ?? "", bucket: `test-api-fayl-${String(process.pid)}` });
  beforeAll(() => ombor.tayyorla());
  afterAll(async () => {
    for await (const o of ombor.kalitlar("")) await ombor.ochir(o.kalit);
    await pool.end();
  });
  beforeEach(() => tozala(pool));
  const ilova = async () => {
    const d = authBogliqliklari(pool);
    return { d, app: await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, fayllar: { ombor, pool, maksHajm: 1024 * 1024 } }) };
  };
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ffbf1e0005fe02fea7d6a4c10000000049454e44ae426082", "hex");
  const sanash = async () => { let n = 0; for await (const o of ombor.kalitlar("")) if (o.kalit) n++; return n; };

  test("yuklash → ro'yxat → berish (Range) → ZIP → olish; dublikat — bitta obyekt", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const v = (await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Hisobot" }).expect(201)).body as { id: number };
    const y = await request(app).post(`/v1/vazifalar/${String(v.id)}/ilovalar`).set("Cookie", aziz).attach("fayl", PNG, { filename: "../chizma (1).png", contentType: "application/octet-stream" }).expect(201);
    const f = y.body as { faylId: number; aslNom: string; mime: string; hajm: number; dublikat: boolean };
    assert.deepEqual([f.aslNom, f.mime, f.hajm, f.dublikat], ["chizma (1).png", "image/png", PNG.length, false]);
    assert.equal(y.headers["location"], `/v1/vazifalar/${String(v.id)}/ilovalar/${String(f.faylId)}`);
    const l = (await request(app).get(`/v1/vazifalar/${String(v.id)}/ilovalar`).set("Cookie", aziz).expect(200)).body as { ilovalar: { faylId: number; aslNom: string }[] };
    assert.deepEqual(l.ilovalar.map((i) => i.aslNom), ["chizma (1).png"]);
    const b = await request(app).get(`/v1/vazifalar/${String(v.id)}/ilovalar/${String(f.faylId)}`).set("Cookie", aziz).buffer(true).parse((res, cb) => { const x: Buffer[] = []; res.on("data", (c: Buffer) => x.push(c)); res.on("end", () => { cb(null, Buffer.concat(x)); }); }).expect(200);
    assert.ok((b.body as Buffer).equals(PNG));
    assert.match(b.headers["content-disposition"] ?? "", /^attachment; filename="chizma \(1\)\.png"/);
    assert.equal(b.headers["x-content-type-options"], "nosniff");
    const r = await request(app).get(`/v1/vazifalar/${String(v.id)}/ilovalar/${String(f.faylId)}`).set("Cookie", aziz).set("Range", "bytes=0-7").expect(206);
    assert.equal(r.headers["content-range"], `bytes 0-7/${String(PNG.length)}`);
    const h = (await request(app).get(`/v1/vazifalar/${String(v.id)}/ilovalar/${String(f.faylId)}?havola=1`).set("Cookie", aziz).expect(200)).body as { url: string };
    assert.equal((await fetch(h.url)).status, 200);
    // O'sha baytlar ikkinchi vazifaga — fayllar jadvalida bitta yozuv, bucket'da bitta obyekt
    const v2 = (await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Boshqa" }).expect(201)).body as { id: number };
    const y2 = (await request(app).post(`/v1/vazifalar/${String(v2.id)}/ilovalar`).set("Cookie", aziz).attach("fayl", PNG, "boshqa.png").expect(201)).body as { faylId: number; dublikat: boolean };
    assert.deepEqual([y2.faylId, y2.dublikat], [f.faylId, true]);
    assert.equal(await sanash(), 1);
    const z = await request(app).get(`/v1/vazifalar/${String(v.id)}/ilovalar.zip`).set("Cookie", aziz).expect(200);
    assert.equal(z.headers["content-type"], "application/zip");
    await request(app).delete(`/v1/vazifalar/${String(v.id)}/ilovalar/${String(f.faylId)}`).set("Cookie", aziz).expect(204);
    await request(app).delete(`/v1/vazifalar/${String(v.id)}/ilovalar/${String(f.faylId)}`).set("Cookie", aziz).expect(404);
  });

  test("xavfsizlik: begona vazifa/ilova 404 va S3 ga yozilmaydi; exe → 415; katta → 413; sessiyasiz → 401", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const dil = await hisobOch(app, d, "dilnoza@example.com");
    const v = (await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Azizniki" }).expect(201)).body as { id: number };
    const f = (await request(app).post(`/v1/vazifalar/${String(v.id)}/ilovalar`).set("Cookie", aziz).attach("fayl", PNG, "a.png").expect(201)).body as { faylId: number };
    const oldin = await sanash();
    await request(app).post(`/v1/vazifalar/${String(v.id)}/ilovalar`).set("Cookie", dil).attach("fayl", Buffer.from("x"), { filename: "b.txt", contentType: "text/plain" }).expect(404);
    await request(app).get(`/v1/vazifalar/${String(v.id)}/ilovalar`).set("Cookie", dil).expect(404);
    await request(app).get(`/v1/vazifalar/${String(v.id)}/ilovalar/${String(f.faylId)}`).set("Cookie", dil).expect(404);
    const exe = Buffer.alloc(512); exe.write("MZ"); exe.write("PE\0\0", 0x80, "latin1"); exe.writeUInt32LE(0x80, 0x3c);
    const e = await request(app).post(`/v1/vazifalar/${String(v.id)}/ilovalar`).set("Cookie", aziz).attach("fayl", exe, { filename: "rasm.png", contentType: "image/png" }).expect(415);
    assert.equal(e.headers["content-type"], "application/problem+json; charset=utf-8");
    await request(app).post(`/v1/vazifalar/${String(v.id)}/ilovalar`).set("Cookie", aziz).attach("fayl", Buffer.alloc(1024 * 1024 + 1, 65), { filename: "k.txt", contentType: "text/plain" }).expect(413);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(await sanash(), oldin);
    await request(app).get(`/v1/vazifalar/${String(v.id)}/ilovalar`).expect(401);
  });

  test("presigned: forma → MinIO'ga to'g'ridan → tasdiq (magic bytes, sha256) → vazifaga biriktirildi; yolg'on tur — rad va o'chirildi", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const v = (await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Presigned" }).expect(201)).body as { id: number };
    const yukla = async (tana: Buffer, tur: string) => {
      const fm = (await request(app).post("/v1/fayllar/forma").set("Cookie", aziz).send({ nom: "skrin.png", tur, hajm: tana.length }).expect(201)).body as { faylId: number; url: string; maydonlar: Record<string, string> };
      const fd = new FormData();
      for (const [k, x] of Object.entries(fm.maydonlar)) fd.append(k, x);
      fd.append("file", new Blob([new Uint8Array(tana)]));
      assert.equal((await fetch(fm.url, { method: "POST", body: fd })).status, 204);
      return fm.faylId;
    };
    const id = await yukla(PNG, "image/png");
    // IDOR: boshqa foydalanuvchi begona faylId ni tasdiqlay olmaydi (WHERE egasi_id — RLS'siz rol bilan ham)
    const dil = await hisobOch(app, d, "dilnoza@example.com");
    await request(app).post(`/v1/fayllar/${String(id)}/tasdiq`).set("Cookie", dil).send({}).expect(404);
    const t =(await request(app).post(`/v1/fayllar/${String(id)}/tasdiq`).set("Cookie", aziz).send({ vazifaId: v.id, aslNom: "skrin.png" }).expect(200)).body as { faylId: number; holat: string };
    assert.equal(t.holat, "tayyor");
    const q = (await pool.query<{ kalit: string; sha: string }>("SELECT kalit, encode(sha256, 'hex') AS sha FROM fayllar WHERE id = $1", [t.faylId])).rows[0];
    assert.match(q?.kalit ?? "", /^fayllar\/\d+\/[0-9a-f-]{36}\.png$/);
    assert.equal(q?.sha, createHash("sha256").update(PNG).digest("hex"));
    const l = (await request(app).get(`/v1/vazifalar/${String(v.id)}/ilovalar`).set("Cookie", aziz).expect(200)).body as { ilovalar: { aslNom: string }[] };
    assert.deepEqual(l.ilovalar.map((i) => i.aslNom), ["skrin.png"]);
    const yomon = await yukla(Buffer.concat([Buffer.from("<html><script>alert(1)</script>"), Buffer.alloc(10)]), "image/png");
    await request(app).post(`/v1/fayllar/${String(yomon)}/tasdiq`).set("Cookie", aziz).send({}).expect(415);
    assert.equal((await pool.query("SELECT 1 FROM fayllar WHERE id = $1", [yomon])).rowCount, 0);
    await request(app).post("/v1/fayllar/forma").set("Cookie", aziz).send({ nom: "x.svg", tur: "image/svg+xml", hajm: 10 }).expect(422);
    await request(app).post("/v1/fayllar/forma").set("Cookie", aziz).send({ nom: "x.png", tur: "image/png", hajm: 2 * 1024 * 1024 }).expect(413);
  });
}
