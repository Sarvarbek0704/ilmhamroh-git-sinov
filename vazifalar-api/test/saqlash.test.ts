// saqlash.test.ts — 31-qism #11/#12: saqlash muddati va hisobni o'chirish (sql/302). Tozalash funksiyalari faqat muddati o'tganlarni oladi;
// DELETE /v1/auth/men — parol bilan tasdiq, shaxsiy ma'lumot qolmaydi (hamma FK jadvallar), statistika (id) qoladi, sessiya darhol yaroqsiz.
// Auth test bazasi kerak; bo'lmasa SKIP.
import { afterAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "./yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { tizimIshlovi } from "../src/navbat/ishlovchilar.ts";
import { authBaza, authBogliqliklari, hisobOch, PAROL, tozala } from "./auth-yordam.ts";

const baza = await authBaza("saqlash");
if (typeof baza === "string") {
  test.skip(`saqlash muddati (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  beforeEach(() => tozala(pool));
  const ilova = async () => {
    const d = authBogliqliklari(pool);
    return { d, app: await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d }) };
  };

  test("ochirilganlarni_tozala: faqat 30 kundan eski yumshoq o'chirilganlar (paketlab); auth_tozala: eski hodisa va tugagan sessiyalar", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    for (const m of ["Eski", "Yangi o'chirilgan", "Faol"]) await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: m }).expect(201);
    await pool.query("UPDATE vazifalar SET ochirilgan_vaqt = now() - interval '40 days' WHERE matn = 'Eski'");
    await pool.query("UPDATE vazifalar SET ochirilgan_vaqt = now() - interval '2 days' WHERE matn = 'Yangi o''chirilgan'");
    assert.equal(Number((await pool.query<{ n: string | number }>("SELECT ochirilganlarni_tozala(interval '30 days', 1) AS n")).rows[0]?.n), 1);
    assert.deepEqual((await pool.query<{ matn: string }>("SELECT matn FROM vazifalar ORDER BY id")).rows.map((r) => r.matn), ["Yangi o'chirilgan", "Faol"]);

    await pool.query("UPDATE auth_hodisalar SET vaqt = now() - interval '200 days' WHERE tur = 'royxat'");
    await pool.query("UPDATE sessiyalar SET bekor_vaqti = now() - interval '8 days' WHERE id = (SELECT min(id) FROM sessiyalar)");
    const n = (await pool.query<{ n: Record<string, number> }>("SELECT auth_tozala() AS n")).rows[0]?.n ?? {};
    assert.equal(n["auth_hodisalar"], 1);
    assert.equal(n["sessiyalar"], 1);
  });

  test("ishchi: 'saqlash-muddati' rejali ishi — uchala tozalash (vazifalar_ishchi roli huquqlari bilan)", async () => {
    const ishchi = (await import("../src/vazifalar/pg-ombor.ts")).pgPool(Object.assign(new URL(pool.options.connectionString ?? ""), { username: "vazifalar_ishchi" }).toString(), { max: 2 });
    try {
      const n = await tizimIshlovi({ ishchi } as never)({ name: "saqlash-muddati" } as never) as Record<string, unknown>;
      assert.deepEqual(Object.keys(n).sort(), ["auth", "hodisa_bolimlari", "vazifalar"]);
    } finally {
      await ishchi.end();
    }
  });

  test("DELETE /v1/auth/men: parolsiz 422, noto'g'ri parol 403; to'g'ri — 204, shaxsiy ma'lumot qolmaydi, hodisalar (statistika) qoladi, sessiya o'ladi", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const dil = await hisobOch(app, d, "dilnoza@example.com");
    await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Shaxsiy reja #maxfiy" }).expect(201);
    await request(app).post("/v1/vazifalar").set("Cookie", dil).send({ matn: "Dilnozaniki" }).expect(201);
    const { rows: [{ id } = { id: "0" }] } = await pool.query<{ id: string }>("SELECT id FROM foydalanuvchilar WHERE email = 'aziz@example.com'");
    await pool.query("INSERT INTO vazifa_hodisalari (egasi_id, tur) VALUES ($1, 'ai_qadamlar')", [id]);

    await request(app).delete("/v1/auth/men").set("Cookie", aziz).send({}).expect(422); // tana validatsiyasi — 422 (25-qism kelishuvi)
    await request(app).delete("/v1/auth/men").set("Cookie", aziz).send({ parol: "noto'g'ri-parol-123" }).expect(403);
    await request(app).delete("/v1/auth/men").set("Cookie", aziz).send({ parol: PAROL }).expect(204);
    await request(app).get("/v1/vazifalar").set("Cookie", aziz).expect(401);

    const f = (await pool.query<Record<string, unknown>>("SELECT email, toliq_ism, parol_hash, bloklangan_vaqt IS NOT NULL AS bloklangan FROM foydalanuvchilar WHERE id = $1", [id])).rows[0];
    assert.deepEqual(f, { email: `ochirilgan-${id}@ochirilgan.invalid`, toliq_ism: "O'chirilgan foydalanuvchi", parol_hash: null, bloklangan: true });
    for (const j of ["vazifalar", "teglar", "sessiyalar"]) {
      const ustun = j === "sessiyalar" ? "foydalanuvchi_id" : "egasi_id";
      assert.equal((await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${j} WHERE ${ustun} = $1`, [id])).rows[0]?.n, 0, j);
    }
    assert.equal((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM auth_hodisalar WHERE foydalanuvchi_id = $1 AND ip IS NOT NULL", [id])).rows[0]?.n, 0);
    assert.ok(((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM vazifa_hodisalari WHERE egasi_id = $1", [id])).rows[0]?.n ?? 0) >= 2); // statistika qoldi
    assert.equal((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM vazifalar WHERE matn = 'Dilnozaniki'")).rows[0]?.n, 1); // begonaga tegmadi
    await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL }).expect(401);
  });
}
