// hujum.test.ts — #27 B-130 (holat 27): injection va mass assignment — hujum ssenariylari HAQIQIY Postgres bilan (yangi auth yo'llari ham):
// SQL injection (login, qidiruv, saralash, kursor), NoSQL-uslub operator obyektlari, mass assignment (egasiId, id, versiya, rol), prototype pollution,
// log va sarlavha (CRLF) injection, katta/chuqur JSON. Xulosa jadvali — docs/OWASP-API.md (#31).
import { afterAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { logYarat } from "../src/umumiy/log.ts";
import { authBaza, authBogliqliklari, hisobOch, PAROL, tozala } from "./auth-yordam.ts";

const baza = await authBaza("hujum");
if (typeof baza === "string") {
  test.skip(`hujum (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  const loglar: string[] = [];
  const d = authBogliqliklari(pool);
  const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, log: logYarat("info", { write: (q: string) => { loglar.push(q); } }) });
  let aziz = "", dilnoza = "";
  beforeEach(async () => {
    await tozala(pool);
    aziz = await hisobOch(app, d, "aziz@example.com");
    dilnoza = await hisobOch(app, d, "dilnoza@example.com");
    await request(app).post("/v1/vazifalar").set("Cookie", dilnoza).send({ matn: "Dilnozaning maxfiy vazifasi" }).expect(201);
  });

  test("SQL injection: login email, qidiruv, saralash, teg — parametrlar/oq ro'yxat; begona ma'lumot chiqmaydi", async () => {
    for (const email of ["' OR '1'='1' --@x.uz", "aziz@example.com' --", "aziz@example.com'; DROP TABLE foydalanuvchilar; --"]) {
      await request(app).post("/v1/auth/kirish").send({ email, parol: PAROL }).expect((r) => { assert.ok([401, 422].includes(r.status), `${email}: ${String(r.status)}`); });
    }
    for (const q of ["' OR 1=1 --", "%", "_", "\\", "x' UNION SELECT matn FROM vazifalar --"]) {
      const r = await request(app).get(`/v1/vazifalar?q=${encodeURIComponent(q)}`).set("Cookie", aziz).expect(200);
      assert.equal((r.body as { vazifalar: unknown[] }).vazifalar.length, 0, q);
    }
    await request(app).get("/v1/vazifalar?sort=matn;DROP%20TABLE%20vazifalar").set("Cookie", aziz).expect(400);
    await request(app).get("/v1/vazifalar?sort=constructor").set("Cookie", aziz).expect(400);
    await request(app).get(`/v1/vazifalar?teg=${encodeURIComponent("x' OR '1'='1")}`).set("Cookie", aziz).expect(400); // teg oq ro'yxat regex'i (25-qism)
    assert.equal((await pool.query("SELECT 1 FROM foydalanuvchilar")).rowCount, 2);
  });

  test("operator obyektlari (NoSQL uslubidagi) va noto'g'ri turlar — 422/400, hech qayerda 500 yo'q", async () => {
    await request(app).post("/v1/auth/kirish").send({ email: { $ne: null }, parol: { $ne: null } }).expect(422);
    await request(app).post("/v1/auth/kirish").send({ email: ["aziz@example.com"], parol: PAROL }).expect(422);
    await request(app).get("/v1/vazifalar?bajarildi[$ne]=true").set("Cookie", aziz).expect(400);
    await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: { toString: "x" } }).expect(422);
    await request(app).patch("/v1/vazifalar/1e3").set("Cookie", aziz).send({ bajarildi: true }).expect(400);
  });

  test("mass assignment: vazifaga egasiId/id/versiya/yaratildi — 422 (strictObject — 25-qismdan beri oq ro'yxat), maydonlar ro'yxati javobda; auth yo'llarida rol — 422", async () => {
    const r = await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Meniki", egasiId: 2, egasi_id: 2, id: 999, versiya: 77, yaratildi: "2000-01-01T00:00:00.000Z" }).expect(422);
    assert.match(JSON.stringify(r.body), /egasiId/);
    for (const [y, b] of [["patch", { bajarildi: true, egasiId: 2 }], ["put", { matn: "x", bajarildi: false, versiya: 9 }]] as const) {
      const v = (await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: `Asl ${y}` }).expect(201)).body as { id: number };
      await request(app)[y](`/v1/vazifalar/${String(v.id)}`).set("Cookie", aziz).send(b).expect(422);
    }
    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM vazifalar WHERE egasi_id = 2");
    assert.equal(rows[0]?.n, 1); // Dilnozada faqat o'zining vazifasi
    await request(app).post("/v1/auth/royxat").send({ email: "x@example.com", toliqIsm: "X", parol: PAROL, rol: "admin" }).expect(422);
    await request(app).post("/v1/auth/royxat").send({ email: "y@example.com", toliqIsm: "Y", parol: PAROL, emailTasdiqlangan: true }).expect(422);
    await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL, rol: "admin" }).expect(422);
  });

  test("prototype pollution: __proto__ / constructor.prototype tanada — global Object.prototype ifloslanmaydi, javob oddiy", async () => {
    const tana = '{"matn":"Proto sinov","__proto__":{"admin":true,"isAdmin":true},"constructor":{"prototype":{"ifloslangan":true}}}';
    // JSON.parse "__proto__" ni oddiy (own) kalit qiladi — strictObject uni noma'lum maydon deb rad etadi; Object.assign/lodash.merge bo'lganda xavfli bo'lardi
    await request(app).post("/v1/vazifalar").set("Cookie", aziz).set("Content-Type", "application/json").send(tana).expect(422);
    assert.equal(({} as Record<string, unknown>)["isAdmin"], undefined);
    assert.equal(({} as Record<string, unknown>)["ifloslangan"], undefined);
    await request(app).post("/v1/auth/kirish").set("Content-Type", "application/json").send('{"__proto__":{"email":"aziz@example.com"},"parol":"x"}').expect(422);
  });

  test("log injection: CRLF va soxta JSON qator emailda — pino har yozuvni bitta JSON qator qilib ekranlaydi", async () => {
    loglar.length = 0;
    // (User-Agent'ga \n — HTTP mijoz (Node) o'zi rad etadi: ERR_INVALID_CHAR; shuning uchun hujum tana orqali)
    await request(app).post("/v1/auth/kirish").send({ email: "a@b.uz\r\n{\"daraja\":\"info\",\"msg\":\"admin kirdi\"}", parol: "x" });
    assert.ok(loglar.length > 0);
    for (const q of loglar) assert.doesNotThrow(() => JSON.parse(q)); // har qator — yaroqli bitta JSON, kiritilgan "qator" alohida yozuv bo'lib qolmadi
    assert.ok(!loglar.some((q) => q.startsWith('{"daraja":"info","msg":"admin kirdi"')));
  });

  test("sarlavha (CRLF) injection: Node javob sarlavhasiga \\r\\n qo'ymaydi; X-Request-Id yaroqsiz — yangisi", async () => {
    const r = await request(app).get("/v1/vazifalar").set("X-Request-Id", "abc def").set("Cookie", aziz).expect(200);
    assert.match(String(r.headers["x-request-id"]), /^[0-9a-f-]{36}$/);
    const { ServerResponse } = await import("node:http");
    const s = new ServerResponse({ method: "GET" } as never);
    assert.throws(() => { s.setHeader("Location", "/v1\r\nSet-Cookie: x=1"); }, /ERR_INVALID_CHAR|Invalid character/);
  });

  test("katta va chuqur JSON: 16 KB dan katta — 413; 2 500 darajali chuqur obyekt (15 001 bayt — 16 KB ichida) — 422, server yiqilmaydi", async () => {
    await request(app).post("/v1/vazifalar").set("Cookie", aziz).set("Content-Type", "application/json").send(`{"matn":"${"a".repeat(17_000)}"}`).expect(413);
    const chuqur = `${'{"a":'.repeat(2_500)}1${"}".repeat(2_500)}`;
    // 30 B BACKLOG 5: test nomi kod bilan mos — 2 500 daraja (5 000 daraja 16 KB ga sig'maydi: 30 001 bayt, 413 bo'lardi)
    assert.equal(Buffer.byteLength(chuqur), 15_001);
    await request(app).post("/v1/vazifalar").set("Cookie", aziz).set("Content-Type", "application/json").send(chuqur).expect(422);
    await request(app).get("/v1/vazifalar").set("Cookie", aziz).expect(200);
  });
}
