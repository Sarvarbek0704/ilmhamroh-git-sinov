// email.test.ts — #12 (holat 12): email tasdiqlash va parol tiklash oqimlari — bir martalik token (hash), muddat, qayta ishlatish, qayta yuborish oralig'i,
// enumeration'siz javob, tiklashdan keyin barcha sessiyalar bekor, pre-hijacking.
import { afterAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { authBaza, authBogliqliklari, cookieniOl, hisobOch, PAROL, tozala, xatToken } from "./auth-yordam.ts";

const baza = await authBaza("email");

if (typeof baza === "string") {
  test.skip(`email oqimlari (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  const d = authBogliqliklari(pool);
  const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d });
  const pochta = d.pochtachi;
  const YANGI = "Yangi-bahor-paroli-2027";
  beforeEach(async () => {
    await tozala(pool);
    pochta.yuborilgan.length = 0;
  });
  const royxat = (email = "aziz@example.com") => request(app).post("/v1/auth/royxat").send({ email, toliqIsm: "Aziz Karimov", parol: PAROL }).expect(202);
  const kir = (parol = PAROL) => request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol });

  test("tasdiqlash: tasdiqlanmagan hisob bilan kirish — 403; havola → sessiya; o'sha havola ikkinchi marta — 400", async () => {
    await royxat();
    const r403 = await kir().expect(403);
    assert.equal((r403.body as { kod: string }).kod, "email-tasdiqlanmagan");
    const token = await xatToken(d);
    const t = await request(app).post("/v1/auth/email-tasdiq").send({ token }).expect(200);
    assert.ok(cookieniOl(t.headers["set-cookie"]));
    await kir().expect(200);
    const r400 = await request(app).post("/v1/auth/email-tasdiq").send({ token }).expect(400);
    assert.equal((r400.body as { kod: string }).kod, "token-yaroqsiz");
  });

  test("bazada token emas, sha256; noto'g'ri shakl, begona maqsad, muddati o'tgan — 400", async () => {
    await royxat();
    const token = await xatToken(d);
    assert.equal((await pool.query("SELECT 1 FROM bir_martalik_tokenlar t WHERE t::text LIKE '%' || $1 || '%'", [token.slice(0, 12)])).rowCount, 0);
    await request(app).post("/v1/auth/email-tasdiq").send({ token: "x" }).expect(400);
    await request(app).post("/v1/auth/parol-tiklash").send({ token, parol: YANGI }).expect(400); // email_tasdiq tokeni parolga yaramaydi
    await pool.query("UPDATE bir_martalik_tokenlar SET yaratilgan_vaqt = now() - interval '25 hours', tugash_vaqti = now() - interval '1 hour'");
    await request(app).post("/v1/auth/email-tasdiq").send({ token }).expect(400);
  });

  test("qayta yuborish: 60 s ichida yangi xat yo'q; keyin — yangi xat, eski havola bekor", async () => {
    await royxat();
    const birinchi = await xatToken(d);
    await request(app).post("/v1/auth/email-tasdiq/qayta").send({ email: "aziz@example.com" }).expect(202);
    await d.fon.tugashi();
    assert.equal(pochta.yuborilgan.length, 1);
    await pool.query("UPDATE bir_martalik_tokenlar SET yaratilgan_vaqt = now() - interval '61 seconds'");
    await request(app).post("/v1/auth/email-tasdiq/qayta").send({ email: "aziz@example.com" }).expect(202);
    await d.fon.tugashi();
    assert.equal(pochta.yuborilgan.length, 2);
    await request(app).post("/v1/auth/email-tasdiq").send({ token: birinchi }).expect(400);
    await request(app).post("/v1/auth/email-tasdiq").send({ token: await xatToken(d) }).expect(200);
  });

  test("parol tiklash so'rovi: mavjud va noma'lum email — bir xil 202 tanasi; xat faqat mavjudga; jurnalda farq", async () => {
    await royxat();
    await d.fon.tugashi();
    pochta.yuborilgan.length = 0;
    const a = await request(app).post("/v1/auth/parol-tiklash/sorov").send({ email: "aziz@example.com" }).expect(202);
    const b = await request(app).post("/v1/auth/parol-tiklash/sorov").send({ email: "yoq@example.com" }).expect(202);
    assert.deepEqual(a.body, b.body);
    await d.fon.tugashi();
    assert.deepEqual(pochta.yuborilgan.map((x) => x.kimga), ["aziz@example.com"]);
    await d.fon.tugashi();
    assert.match(pochta.yuborilgan[0]?.matn ?? "", /\/parol-tiklash#token=[A-Za-z0-9_-]{43}/);
    const { rows } = await pool.query<{ t: string }>("SELECT tafsilot->>'topildi' AS t FROM auth_hodisalar WHERE tur = 'parol_tiklash_sorov' ORDER BY id");
    assert.deepEqual(rows.map((x) => x.t), ["true", "false"]);
  });

  test("parol tiklash: zaif parol — 422 va havola YONMAYDI; yaxshi parol — 204, BARCHA sessiyalar bekor, eski parol 401, yangisi 200; havola qayta — 400", async () => {
    const eski = await hisobOch(app, d, "aziz@example.com", "Aziz Karimov");
    const ikkinchi = cookieniOl((await kir().expect(200)).headers["set-cookie"]);
    await request(app).post("/v1/auth/parol-tiklash/sorov").send({ email: "aziz@example.com" }).expect(202);
    const token = await xatToken(d);
    const r = await request(app).post("/v1/auth/parol-tiklash").send({ token, parol: "aziz-karimov-yangi-parol" }).expect(422);
    assert.match(JSON.stringify(r.body), /ismingiz/);
    const ok = await request(app).post("/v1/auth/parol-tiklash").set("Cookie", ikkinchi).send({ token, parol: YANGI }).expect(204);
    assert.match((ok.headers["set-cookie"] as unknown as string[])[0] ?? "", /Expires=Thu, 01 Jan 1970/);
    for (const c of [eski, ikkinchi]) await request(app).get("/v1/vazifalar").set("Cookie", c).expect(401);
    await kir().expect(401);
    await kir(YANGI).expect(200);
    await request(app).post("/v1/auth/parol-tiklash").send({ token, parol: "Yana-boshqa-parol-2028" }).expect(400);
    const { rows } = await pool.query<{ n: string }>("SELECT tafsilot->>'bekorSessiyalar' AS n FROM auth_hodisalar WHERE tur = 'parol_tiklandi'");
    assert.equal(rows[0]?.n, "2");
  });

  test("bitta havola bilan bir vaqtda 5 so'rov — faqat bittasi muvaffaqiyatli (UPDATE … RETURNING atomik)", async () => {
    await royxat();
    await pool.query("UPDATE foydalanuvchilar SET email_tasdiqlangan_vaqt = now()");
    await request(app).post("/v1/auth/parol-tiklash/sorov").send({ email: "aziz@example.com" }).expect(202);
    const token = await xatToken(d);
    const n = await Promise.all(Array.from({ length: 5 }, (_, i) => request(app).post("/v1/auth/parol-tiklash").send({ token, parol: `${YANGI}-${String(i)}` })));
    assert.deepEqual(n.map((x) => x.status).sort(), [204, 400, 400, 400, 400]);
  });

  test("pre-hijacking: hujumchi qurbonning emailiga oldindan hisob ochadi — kira olmaydi (tasdiqlanmagan); qurbon parolni tiklab hisobni oladi", async () => {
    await request(app).post("/v1/auth/royxat").send({ email: "qurbon@example.com", toliqIsm: "Soxta Ism", parol: "Hujumchining-maxfiy-paroli" }).expect(202);
    await request(app).post("/v1/auth/kirish").send({ email: "qurbon@example.com", parol: "Hujumchining-maxfiy-paroli" }).expect(403);
    await request(app).post("/v1/auth/parol-tiklash/sorov").send({ email: "qurbon@example.com" }).expect(202);
    await request(app).post("/v1/auth/parol-tiklash").send({ token: await xatToken(d, "qurbon@example.com"), parol: YANGI }).expect(204);
    await request(app).post("/v1/auth/kirish").send({ email: "qurbon@example.com", parol: "Hujumchining-maxfiy-paroli" }).expect(401);
    await request(app).post("/v1/auth/kirish").send({ email: "qurbon@example.com", parol: YANGI }).expect(200);
  });
}
