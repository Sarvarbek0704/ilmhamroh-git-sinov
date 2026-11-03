// otp.test.ts — #13 (holat 13): SMS kod bilan kirish va telefonni ulash — HMAC, 5 urinish, muddat, bir marta, chastota, mamlakat, maqsad ajratilgani.
import { afterAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { telefonNormallash, yangiKod } from "../src/auth/otp.ts";
import { authBaza, authBogliqliklari, cookieniOl, hisobOch, tozala } from "./auth-yordam.ts";

test("telefonNormallash — E.164; 9 raqam → +998; yaroqsizlar", () => {
  for (const [x, k] of [["+998 90 000-00-00", "+998900000000"], ["998900000000", "+998900000000"], ["90 000 00 00", "+998900000000"], ["(90) 0000000", "+998900000000"], ["+7 912 345 67 89", "+79123456789"]] as const) {
    assert.equal(telefonNormallash(x), k, x);
  }
  for (const x of ["", "12345", "+0123456789", "abc", "+998 90 000 00 00 00 00 0"]) assert.equal(telefonNormallash(x), undefined, x);
});

test("yangiKod — har doim 6 raqam, oldidagi nollar bilan, takrorlar kam (10 000 ta)", () => {
  const k = Array.from({ length: 10_000 }, yangiKod);
  assert.ok(k.every((x) => /^\d{6}$/.test(x)));
  assert.ok(k.some((x) => x.startsWith("0")));
  assert.ok(new Set(k).size > 9_900);
});

const baza = await authBaza("otp");
if (typeof baza === "string") {
  test.skip(`OTP (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  const d = authBogliqliklari(pool);
  const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d });
  const TEL = "+998900000000";
  const kod = async (tel = TEL) => {
    await d.fon.tugashi();
    const k = d.sms.oxirgiKod(tel);
    if (k === undefined) throw new Error("SMS kelmadi");
    return k;
  };
  /** Aziz: hisob + tasdiqlangan raqam */
  async function tayyor(): Promise<string> {
    const c = await hisobOch(app, d, "aziz@example.com");
    await request(app).post("/v1/auth/telefon").set("Cookie", c).send({ telefon: "90 000 00 00" }).expect(202);
    const r = await request(app).post("/v1/auth/telefon/tasdiq").set("Cookie", c).send({ telefon: TEL, kod: await kod() }).expect(200);
    assert.deepEqual(r.body, { telefon: TEL });
    await pool.query("TRUNCATE otp_kodlar"); // ulash kodlari chastota hisobiga kirmasin
    d.sms.yuborilgan.length = 0;
    return c;
  }
  beforeEach(async () => {
    await tozala(pool);
    d.sms.yuborilgan.length = 0;
  });

  test("raqamni ulash → SMS kod bilan kirish → sessiya; kod bazada ochiq emas (HMAC)", async () => {
    await tayyor();
    await request(app).post("/v1/auth/otp/yubor").send({ telefon: "+998 90 000 00 00" }).expect(202);
    const k = await kod();
    assert.equal((await pool.query("SELECT 1 FROM otp_kodlar o WHERE o::text LIKE '%' || $1 || '%'", [k])).rowCount, 0);
    const r = await request(app).post("/v1/auth/otp/kirish").send({ telefon: TEL, kod: k }).expect(200);
    await request(app).get("/v1/auth/men").set("Cookie", cookieniOl(r.headers["set-cookie"])).expect(200);
    await request(app).post("/v1/auth/otp/kirish").send({ telefon: TEL, kod: k }).expect(401); // bir marta
  });

  test("noma'lum raqam — o'sha 202 tanasi, SMS yuborilmaydi; boshqa mamlakat va noto'g'ri raqam — 422", async () => {
    await tayyor();
    const a = await request(app).post("/v1/auth/otp/yubor").send({ telefon: TEL }).expect(202);
    const b = await request(app).post("/v1/auth/otp/yubor").send({ telefon: "+998911111111" }).expect(202);
    assert.deepEqual(a.body, b.body);
    await d.fon.tugashi();
    assert.deepEqual(d.sms.yuborilgan.map((x) => x.telefon), [TEL]);
    await request(app).post("/v1/auth/otp/yubor").send({ telefon: "+1 900 555 0100" }).expect(422);
    await request(app).post("/v1/auth/otp/yubor").send({ telefon: "abc" }).expect(422);
  });

  test("5 ta noto'g'ri urinishdan keyin TO'G'RI kod ham ishlamaydi; muddati o'tgan kod — 401", async () => {
    await tayyor();
    await request(app).post("/v1/auth/otp/yubor").send({ telefon: TEL }).expect(202);
    const k = await kod();
    const notogri = k === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) await request(app).post("/v1/auth/otp/kirish").send({ telefon: TEL, kod: notogri }).expect(401);
    await request(app).post("/v1/auth/otp/kirish").send({ telefon: TEL, kod: k }).expect(401);
    await pool.query("UPDATE otp_kodlar SET yaratilgan_vaqt = now() - interval '2 minutes'");
    await request(app).post("/v1/auth/otp/yubor").send({ telefon: TEL }).expect(202);
    const k2 = await kod();
    await pool.query("UPDATE otp_kodlar SET tugash_vaqti = now() - interval '1 second' WHERE ishlatilgan_vaqt IS NULL");
    await request(app).post("/v1/auth/otp/kirish").send({ telefon: TEL, kod: k2 }).expect(401);
  });

  test("chastota: 60 s ichida ikkinchi SMS yo'q; soatiga 5 tadan ortiq yo'q (jurnalda cheklov)", async () => {
    await tayyor();
    await request(app).post("/v1/auth/otp/yubor").send({ telefon: TEL }).expect(202);
    await request(app).post("/v1/auth/otp/yubor").send({ telefon: TEL }).expect(202);
    await d.fon.tugashi();
    assert.equal(d.sms.yuborilgan.length, 1);
    for (let i = 0; i < 6; i++) {
      await pool.query("UPDATE otp_kodlar SET yaratilgan_vaqt = yaratilgan_vaqt - interval '61 seconds'");
      await request(app).post("/v1/auth/otp/yubor").send({ telefon: TEL }).expect(202);
      await d.fon.tugashi();
    }
    assert.equal(d.sms.yuborilgan.length, 5);
    const { rows } = await pool.query<{ c: string }>("SELECT tafsilot->>'cheklov' AS c FROM auth_hodisalar WHERE tafsilot ? 'cheklov' ORDER BY id");
    assert.deepEqual(rows.map((x) => x.c), ["oraliq", "soatiga", "soatiga"]);
  });

  test("maqsad ajratilgan: telefon ulash kodi bilan kirib bo'lmaydi; parallel 3 ta to'g'ri so'rov — bittasi 200", async () => {
    const c = await hisobOch(app, d, "aziz@example.com");
    await request(app).post("/v1/auth/telefon").set("Cookie", c).send({ telefon: TEL }).expect(202);
    const ulash = await kod();
    await request(app).post("/v1/auth/otp/kirish").send({ telefon: TEL, kod: ulash }).expect(401);
    await request(app).post("/v1/auth/telefon/tasdiq").set("Cookie", c).send({ telefon: TEL, kod: ulash }).expect(200);
    await pool.query("UPDATE otp_kodlar SET yaratilgan_vaqt = now() - interval '2 minutes'");
    await request(app).post("/v1/auth/otp/yubor").send({ telefon: TEL }).expect(202);
    const k = await kod();
    const n = await Promise.all([1, 2, 3].map(() => request(app).post("/v1/auth/otp/kirish").send({ telefon: TEL, kod: k })));
    assert.deepEqual(n.map((x) => x.status).sort(), [200, 401, 401]);
  });

  test("band raqam: boshqa hisob ulamoqchi bo'lsa — 202, lekin SMS yuborilmaydi; sessiyasiz /telefon — 401", async () => {
    await tayyor();
    const dilnoza = await hisobOch(app, d, "dilnoza@example.com");
    d.sms.yuborilgan.length = 0;
    await request(app).post("/v1/auth/telefon").set("Cookie", dilnoza).send({ telefon: TEL }).expect(202);
    await d.fon.tugashi();
    assert.equal(d.sms.yuborilgan.length, 0);
    await request(app).post("/v1/auth/telefon").send({ telefon: TEL }).expect(401);
  });

  // 30 B BACKLOG 2: NIST 800-63B §5.2.2 — hisob bo'yicha ketma-ket xato urinishlar ≤ 100 (kod bo'yicha 5 — har yangi SMS bilan qayta boshlanardi)
  test("hisob chegarasi: 100 ketma-ket xatodan keyin TO'G'RI kod ham 401 (jurnalda otp-hisob-chegarasi); 99 da — 200 va hisoblagich nollanadi", async () => {
    await tayyor();
    // oldingi kunlarda 20 ta kod × 5 xato = 100 (2 kun oldin — kunlik SMS chastotasiga kirmaydi)
    await pool.query(`INSERT INTO otp_kodlar (foydalanuvchi_id, maqsad, telefon, kod_hmac, yaratilgan_vaqt, tugash_vaqti, urinishlar)
      SELECT 1, 'kirish', $1, sha256(g::text::bytea), now() - interval '2 days', now() - interval '2 days' + interval '5 minutes', 5 FROM generate_series(1, 20) g`, [TEL]);
    await request(app).post("/v1/auth/otp/yubor").send({ telefon: TEL }).expect(202);
    const k = await kod();
    await request(app).post("/v1/auth/otp/kirish").send({ telefon: TEL, kod: k }).expect(401);
    const { rows } = await pool.query<{ sabab: string }>("SELECT tafsilot->>'sabab' AS sabab FROM auth_hodisalar WHERE tur = 'kirish_xato' ORDER BY id DESC LIMIT 1");
    assert.equal(rows[0]?.sabab, "otp-hisob-chegarasi");
    // chegara tekshiruvi kodning o'z urinishini ham sarflamaydi (ROLLBACK) — 99 bo'lsa o'sha kod ishlaydi
    await pool.query("UPDATE otp_kodlar SET urinishlar = 4 WHERE id = (SELECT min(id) FROM otp_kodlar)");
    await request(app).post("/v1/auth/otp/kirish").send({ telefon: TEL, kod: k }).expect(200);
    // muvaffaqiyatdan keyin — eski 99 xato hisobga kirmaydi: yangi kod bilan bitta xato va to'g'ri kod ishlaydi
    await pool.query("UPDATE otp_kodlar SET yaratilgan_vaqt = now() - interval '2 minutes' WHERE ishlatilgan_vaqt IS NOT NULL");
    await request(app).post("/v1/auth/otp/yubor").send({ telefon: TEL }).expect(202);
    const k2 = await kod();
    await request(app).post("/v1/auth/otp/kirish").send({ telefon: TEL, kod: k2 === "000000" ? "111111" : "000000" }).expect(401);
    await request(app).post("/v1/auth/otp/kirish").send({ telefon: TEL, kod: k2 }).expect(200);
  });
}
