// statistika.test.ts — 31-qism #05/#09/#12: vazifa hodisalari (sql/301): trigger hodisa yozadi, oyma-oy bo'limlar, kunlik statistika (begona hodisalar
// ko'rinmaydi), eski bo'limni DETACH + DROP. Auth test bazasi kerak; bo'lmasa SKIP.
import { afterAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "./yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { BolimlarXizmati } from "../src/statistika/statistika.module.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";

const baza = await authBaza("statistika");
if (typeof baza === "string") {
  test.skip(`vazifa hodisalari (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  beforeEach(() => tozala(pool));
  const ilova = async () => {
    const d = authBogliqliklari(pool);
    return { d, app: await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, statistika: { pool } }) };
  };

  test("trigger: yaratildi → bajarildi → qaytarildi → ochirildi; statistika faqat o'ziniki; kun — Asia/Tashkent", async () => {
    const { d, app } = await ilova();
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const dil = await hisobOch(app, d, "dilnoza@example.com");
    const v = (await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Hisobot yozish" }).expect(201)).body as { id: number };
    const patch = (b: object) => request(app).patch(`/v1/vazifalar/${String(v.id)}`).set("Cookie", aziz).set("Content-Type", "application/merge-patch+json").send(b).expect(200);
    await patch({ bajarildi: true });
    await patch({ bajarildi: false });
    await patch({ matn: "Hisobot yozish #ish" }); // bajarildi/ochirilgan o'zgarmadi — hodisa yo'q
    await request(app).delete(`/v1/vazifalar/${String(v.id)}`).set("Cookie", aziz).expect(204);
    await request(app).post("/v1/vazifalar").set("Cookie", dil).send({ matn: "Dilnozaniki" }).expect(201);

    const { rows } = await pool.query<{ tur: string; bolim: string }>("SELECT tur, tableoid::regclass::text AS bolim FROM vazifa_hodisalari WHERE vazifa_id = $1 ORDER BY vaqt", [v.id]);
    assert.deepEqual(rows.map((r) => r.tur), ["yaratildi", "bajarildi", "qaytarildi", "ochirildi"]);
    assert.match(rows[0]?.bolim ?? "", /^bolimlar\.vazifa_hodisalari_\d{4}_\d{2}$/); // DEFAULT emas — joriy oy bo'limi

    const s = (await request(app).get("/v1/statistika/faollik?kunlar=7").set("Cookie", aziz).expect(200)).body as { tz: string; kunlar: Record<string, unknown>[] };
    const bugun = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
    assert.equal(s.tz, "Asia/Tashkent");
    assert.deepEqual(s.kunlar, [{ kun: bugun, yaratildi: 1, bajarildi: 1, qaytarildi: 1, ochirildi: 1 }]);
    await request(app).get("/v1/statistika/faollik?kunlar=0").set("Cookie", aziz).expect(400);
    await request(app).get("/v1/statistika/faollik").expect(401);
  });

  test("bo'limlar: tayyorla() idempotent; tozala() faqat muddati o'tganini DETACH + DROP qiladi; bo'limsiz vaqt — DEFAULT bo'limga", async () => {
    const xizmat = new BolimlarXizmati({ pool }, { warn: () => undefined, error: () => undefined } as never);
    const a = await xizmat.tayyorla();
    const b = await xizmat.tayyorla();
    assert.equal(a.length, 3);
    assert.deepEqual(a, b);
    await pool.query("SELECT hodisa_bolimi_yarat(date '2024-01-01')");
    await pool.query("INSERT INTO vazifa_hodisalari (vaqt, egasi_id, tur) VALUES ('2024-01-15', 1, 'yaratildi'), ('2030-06-01', 1, 'yaratildi')");
    const { rows: [def] } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM bolimlar.vazifa_hodisalari_boshqa");
    assert.equal(def?.n, 1); // 2030 — oldindan yaratilmagan oy → DEFAULT (yo'qolmadi)
    const { rows } = await pool.query<{ nom: string }>("SELECT hodisa_bolimlari_tozala('13 months') AS nom");
    assert.deepEqual(rows.map((r) => r.nom), ["vazifa_hodisalari_2024_01"]);
    assert.equal((await pool.query<{ r: string | null }>("SELECT to_regclass('bolimlar.vazifa_hodisalari_2024_01')::text AS r")).rows[0]?.r, null);
    await pool.query("DELETE FROM vazifa_hodisalari WHERE vaqt >= '2030-01-01'");
  });
}
