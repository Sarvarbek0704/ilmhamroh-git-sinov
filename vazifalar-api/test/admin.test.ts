// admin.test.ts — #20 (holat 20): RBAC (401 vs 403, rol har so'rovda bazadan), administrator yo'llari (ro'yxat — ortiqcha maydonsiz, bloklash/ochish),
// bloklangan hisob hech qaysi yo'l bilan kira olmaydi; HMAC kursor (25-qism qarori).
import { afterAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { kursorOqi, kursorYoz } from "../src/umumiy/kursor.ts";
import { authBaza, authBogliqliklari, hisobOch, PAROL, tozala } from "./auth-yordam.ts";

test("HMAC kursor: o'z kaliti bilan — ok; ichi o'zgartirilsa, boshqa kalit, imzosiz (25-qism formati), boshqa so'rov imzosi — undefined", () => {
  const k = Buffer.alloc(32, 7);
  const c = kursorYoz([5, 12], "[[],{}]", k);
  assert.deepEqual(kursorOqi(c, "[[],{}]", k), [5, 12]);
  const [t = "", h = ""] = c.split(".");
  const soxta = `${Buffer.from(JSON.stringify({ v: [999999, 1], i: "[[],{}]" })).toString("base64url")}.${h}`;
  assert.equal(kursorOqi(soxta, "[[],{}]", k), undefined);
  assert.equal(kursorOqi(c, "[[],{}]", Buffer.alloc(32, 8)), undefined);
  assert.equal(kursorOqi(t, "[[],{}]", k), undefined);
  assert.equal(kursorOqi(c, "[[\"matn\"],{}]", k), undefined);
});

const baza = await authBaza("admin");
if (typeof baza === "string") {
  test.skip(`admin (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  const d = authBogliqliklari(pool);
  const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d });
  let admin = "", aziz = "";
  beforeEach(async () => {
    await tozala(pool);
    admin = await hisobOch(app, d, "bekzod@example.com");
    aziz = await hisobOch(app, d, "aziz@example.com");
    await pool.query("UPDATE foydalanuvchilar SET rol = 'admin' WHERE email = 'bekzod@example.com'");
  });

  test("401 (sessiyasiz) va 403 (oddiy foydalanuvchi); admin ro'yxati — parol hash, telefon YO'Q; keyset sahifalash", async () => {
    await request(app).get("/v1/admin/foydalanuvchilar").expect(401);
    const r = await request(app).get("/v1/admin/foydalanuvchilar").set("Cookie", aziz).expect(403);
    assert.equal((r.body as { kod: string }).kod, "ruxsat-yoq");
    const l = await request(app).get("/v1/admin/foydalanuvchilar?limit=1").set("Cookie", admin).expect(200);
    const b = l.body as { foydalanuvchilar: Record<string, unknown>[]; keyingi: number | null };
    assert.deepEqual(Object.keys(b.foydalanuvchilar[0] ?? {}).sort(), ["bloklangan", "email", "emailTasdiqlangan", "id", "rol", "toliqIsm", "yaratilgan"]);
    const l2 = await request(app).get(`/v1/admin/foydalanuvchilar?limit=1&keyin=${String(b.keyingi)}`).set("Cookie", admin).expect(200);
    assert.equal((l2.body as { foydalanuvchilar: { email: string }[] }).foydalanuvchilar[0]?.email, "aziz@example.com");
    await request(app).get("/v1/admin/foydalanuvchilar?limit=1000").set("Cookie", admin).expect(400);
  });

  test("bloklash: sessiyasi DARHOL 401, parol bilan kirish 403 hisob-bloklangan; o'zini va boshqa adminni — yo'q; ochilgach — kiradi", async () => {
    await request(app).post("/v1/admin/foydalanuvchilar/2/bloklash").set("Cookie", aziz).expect(403);
    await request(app).post("/v1/admin/foydalanuvchilar/2/bloklash").set("Cookie", admin).expect(204);
    await request(app).get("/v1/vazifalar").set("Cookie", aziz).expect(401);
    const k = await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL }).expect(403);
    assert.equal((k.body as { kod: string }).kod, "hisob-bloklangan");
    await request(app).post("/v1/admin/foydalanuvchilar/1/bloklash").set("Cookie", admin).expect(409);
    await pool.query("INSERT INTO foydalanuvchilar (email, toliq_ism, rol) VALUES ('admin2@example.com', 'Ikkinchi', 'admin')");
    await request(app).post("/v1/admin/foydalanuvchilar/3/bloklash").set("Cookie", admin).expect(404);
    await request(app).post("/v1/admin/foydalanuvchilar/2/blokdan-chiqarish").set("Cookie", admin).expect(204);
    await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL }).expect(200);
    const { rows } = await pool.query<{ tur: string; admin: string }>("SELECT tur, tafsilot->>'admin' AS admin FROM auth_hodisalar WHERE tur LIKE 'admin_%' ORDER BY id");
    assert.deepEqual(rows, [{ tur: "admin_bloklash", admin: "1" }, { tur: "admin_blokdan_chiqarish", admin: "1" }]);
  });

  test("rol har so'rovda bazadan: adminlikdan olinsa — o'sha sessiya bilan darhol 403", async () => {
    await request(app).get("/v1/admin/foydalanuvchilar").set("Cookie", admin).expect(200);
    await pool.query("UPDATE foydalanuvchilar SET rol = 'foydalanuvchi' WHERE id = 1");
    await request(app).get("/v1/admin/foydalanuvchilar").set("Cookie", admin).expect(403);
  });

  test("API'dagi kursor imzolangan: o'zgartirilgan kursor — 400", async () => {
    for (const m of ["a", "b", "c"]) await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: m }).expect(201);
    const r = await request(app).get("/v1/vazifalar?limit=1").set("Cookie", aziz).expect(200);
    const k = (r.body as { sahifa: { keyingi: string } }).sahifa.keyingi;
    await request(app).get(`/v1/vazifalar?limit=1&cursor=${k}`).set("Cookie", aziz).expect(200);
    const [t = "", h = ""] = k.split(".");
    const ichi = JSON.parse(Buffer.from(t, "base64url").toString()) as { v: number[]; i: string };
    const soxta = `${Buffer.from(JSON.stringify({ ...ichi, v: [0, 0] })).toString("base64url")}.${h}`;
    await request(app).get(`/v1/vazifalar?limit=1&cursor=${soxta}`).set("Cookie", aziz).expect(400);
  });
}
