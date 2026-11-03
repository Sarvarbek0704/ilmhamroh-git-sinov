// prodakshn.test.ts — 31-qism #23 audit jurnali (sql/305: faqat qo'shiladi, hash zanjiri) va #25 feature flag'lar (sql/306), BACKLOG: /v1/auth/men da rol.
// Auth test bazasi kerak; bo'lmasa SKIP (toza funksiyalar — doim).
import { afterAll, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "./yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { SoxtaProvayder } from "../src/ai/soxta.ts";
import { baholash, chelak } from "../src/bayroq/bayroqlar.ts";
import { authBaza, authBogliqliklari, hisobOch, PAROL, tozala } from "./auth-yordam.ts";

describe("#25 bayroqni baholash (toza funksiya)", () => {
  const b = { kalit: "yangi-xususiyat", yoqilgan: true, foiz: 30, rollar: ["admin"], foydalanuvchilar: [7] };
  test("kill switch > ruxsat ro'yxati > rol > foiz; jadvalda yo'q — cheklanmagan; deterministik", () => {
    assert.equal(baholash({ ...b, yoqilgan: false }, { id: 7, rol: "admin" }), false);
    assert.equal(baholash({ ...b, foiz: 0 }, { id: 7 }), true);
    assert.equal(baholash({ ...b, foiz: 0 }, { id: 8, rol: "admin" }), true);
    assert.equal(baholash(undefined, { id: 1 }), true);
    assert.equal(chelak("a", 42), chelak("a", 42));
  });
  test("foizli rollout: 10 000 foydalanuvchi, 30 % → 28–32 %; 30 → 50 % da avvalgi yoqilganlarning HAMMASI yoqiq qoladi", () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => i + 1);
    const y30 = ids.filter((id) => baholash({ ...b, rollar: [], foydalanuvchilar: [] }, { id }));
    const y50 = new Set(ids.filter((id) => baholash({ ...b, foiz: 50, rollar: [], foydalanuvchilar: [] }, { id })));
    assert.ok(y30.length >= 2800 && y30.length <= 3200, `30 %: ${String(y30.length)}`);
    assert.ok(y30.every((id) => y50.has(id)));
  });
});

const baza = await authBaza("prodakshn");
if (typeof baza === "string") {
  test.skip(`audit va bayroqlar (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  beforeEach(() => tozala(pool));
  const tayyorla = async () => {
    const d = authBogliqliklari(pool);
    const p = new SoxtaProvayder({ javob: () => JSON.stringify({ qadamlar: [{ matn: "a", daqiqa: 1 }, { matn: "b", daqiqa: 2 }] }) });
    const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, ai: { pool, provayder: p } });
    const admin = await hisobOch(app, d, "bekzod@example.com");
    const aziz = await hisobOch(app, d, "aziz@example.com");
    await pool.query("UPDATE foydalanuvchilar SET rol = 'admin' WHERE email = 'bekzod@example.com'");
    // tozala() public jadvallarni TRUNCATE qiladi — 306 dagi boshlang'ich bayroqlar ham ketadi; qayta qo'yamiz
    await pool.query("INSERT INTO bayroqlar (kalit, yoqilgan, foiz) VALUES ('ai-qadamlar', true, 100), ('ai-yordamchi', true, 100)");
    const id = async (email: string) => Number((await pool.query<{ id: string }>("SELECT id FROM foydalanuvchilar WHERE email = $1", [email])).rows[0]?.id);
    return { app, admin, aziz, adminId: await id("bekzod@example.com"), azizId: await id("aziz@example.com") };
  };
  const jurnal = async () => (await pool.query<{ aktyor_id: string | null; amal: string; obyekt_id: string | null }>("SELECT aktyor_id, amal, obyekt_id FROM audit.jurnal ORDER BY id")).rows;

  test("#23 audit: muvaffaqiyatli admin amali va API kalit — yoziladi (aktyor, obyekt), 403 — yozilmaydi; jurnal ro'yxati; zanjir butun → buzilsa topiladi", async () => {
    const { app, admin, aziz, adminId, azizId } = await tayyorla();
    const oldin = (await jurnal()).length;
    await request(app).post(`/v1/admin/foydalanuvchilar/${String(adminId)}/bloklash`).set("Cookie", aziz).expect(403);
    await request(app).post(`/v1/admin/foydalanuvchilar/${String(azizId)}/bloklash`).set("Cookie", admin).expect(204);
    await request(app).post(`/v1/admin/foydalanuvchilar/${String(azizId)}/blokdan-chiqarish`).set("Cookie", admin).expect(204);
    const kalit = (await request(app).post("/v1/auth/api-kalitlar").set("Cookie", admin).send({ nom: "ci", ruxsatlar: ["vazifalar:oqish"] }).expect(201)).body as { id: number; kalit: string };
    const j = (await jurnal()).slice(oldin);
    assert.deepEqual(j.map((x) => [x.amal, x.aktyor_id === null ? null : Number(x.aktyor_id), x.obyekt_id]),
      [["admin.bloklash", adminId, String(azizId)], ["admin.blokdan_chiqarish", adminId, String(azizId)], ["api_kalit.yaratildi", adminId, String(kalit.id)]]); // 32 #01: avval null edi (31 nuqsoni) — yaratilgan kalit id'si javobdan
    assert.ok(!JSON.stringify(j).includes(kalit.kalit)); // kalit qiymati jurnalga tushmaydi
    const l = (await request(app).get("/v1/admin/audit").set("Cookie", admin).expect(200)).body as { yozuvlar: { amal: string; hash: string }[] };
    assert.match(l.yozuvlar.at(-1)?.hash ?? "", /^[0-9a-f]{64}$/);
    await request(app).get("/v1/admin/audit").set("Cookie", aziz).expect(401); // bloklash Azizning HAMMA sessiyalarini bekor qilgan (blokdan chiqarish qaytarmaydi)
    assert.deepEqual((await request(app).post("/v1/admin/audit/tekshir").set("Cookie", admin).expect(200)).body, { butun: true, yozuvlar: j.length + oldin, buzilganlar: [] });
    await assert.rejects(pool.query("UPDATE audit.jurnal SET amal = 'yashirin.amal'"), /faqat qo'shiladi/);
    await assert.rejects(pool.query("DELETE FROM audit.jurnal"), /faqat qo'shiladi/);
    // "superuser trigger'ni o'chirib tahrirladi" — zanjir buni ko'rsatadi
    await pool.query("ALTER TABLE audit.jurnal DISABLE TRIGGER jurnal_ozgarmas");
    const birinchi = (await pool.query<{ id: string }>("SELECT min(id) AS id FROM audit.jurnal WHERE amal = 'admin.bloklash'")).rows[0]?.id;
    await pool.query("UPDATE audit.jurnal SET tafsilot = '{\"metod\":\"GET\"}' WHERE id = $1", [birinchi]);
    await pool.query("ALTER TABLE audit.jurnal ENABLE TRIGGER jurnal_ozgarmas");
    const t = (await request(app).post("/v1/admin/audit/tekshir").set("Cookie", admin).expect(200)).body as { butun: boolean; buzilganlar: { id: number; sabab: string }[] };
    assert.equal(t.butun, false);
    assert.deepEqual(t.buzilganlar.map((x) => x.id), [Number(birinchi)]);
  });

  test("#23 audit: hisob o'chirish — aktyor o'zi (amaldan keyin sessiya yo'q bo'lsa ham)", async () => {
    const { app, aziz, azizId } = await tayyorla();
    await request(app).delete("/v1/auth/men").set("Cookie", aziz).send({ parol: PAROL }).expect(204);
    assert.deepEqual((await jurnal()).filter((x) => x.amal === "hisob.ochirildi").map((x) => Number(x.aktyor_id)), [azizId]);
  });

  test("#25 bayroqlar: GET /v1/bayroqlar; admin o'chirsa — AI yo'li 404 (xususiyat-yoq), ruxsat ro'yxati bilan yana ochiq; oddiy foydalanuvchi PUT — 403; audit", async () => {
    const { app, admin, aziz, azizId } = await tayyorla();
    assert.deepEqual((await request(app).get("/v1/bayroqlar").set("Cookie", aziz).expect(200)).body, { "ai-qadamlar": true, "ai-yordamchi": true });
    const v = (await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Bayroq sinovi" }).expect(201)).body as { id: number };
    await request(app).post(`/v1/vazifalar/${String(v.id)}/qadamlar`).set("Cookie", aziz).expect(200);
    await request(app).put("/v1/admin/bayroqlar/ai-qadamlar").set("Cookie", aziz).send({ yoqilgan: false, foiz: 0 }).expect(403);
    await request(app).put("/v1/admin/bayroqlar/ai-qadamlar").set("Cookie", admin).send({ yoqilgan: true, foiz: 101 }).expect(422);
    await request(app).put("/v1/admin/bayroqlar/ai-qadamlar").set("Cookie", admin).send({ yoqilgan: true, foiz: 0 }).expect(200);
    const r = await request(app).post(`/v1/vazifalar/${String(v.id)}/qadamlar`).set("Cookie", aziz).expect(404);
    assert.match((r.body as { type: string }).type, /xususiyat-yoq$/);
    assert.equal(((await request(app).get("/v1/bayroqlar").set("Cookie", aziz).expect(200)).body as Record<string, boolean>)["ai-qadamlar"], false);
    await request(app).put("/v1/admin/bayroqlar/ai-qadamlar").set("Cookie", admin).send({ yoqilgan: true, foiz: 0, foydalanuvchilar: [azizId] }).expect(200);
    await request(app).post(`/v1/vazifalar/${String(v.id)}/qadamlar`).set("Cookie", aziz).expect(200);
    await request(app).put("/v1/admin/bayroqlar/ai-qadamlar").set("Cookie", admin).send({ yoqilgan: false, foiz: 100, foydalanuvchilar: [azizId] }).expect(200);
    await request(app).post(`/v1/vazifalar/${String(v.id)}/qadamlar`).set("Cookie", aziz).expect(404); // kill switch ro'yxatdan ustun
    assert.equal((await jurnal()).filter((x) => x.amal === "bayroq.ozgartirildi" && x.obyekt_id === "ai-qadamlar").length, 3);
  });

  test("ochiq xato (30 BACKLOG): GET /v1/auth/men javobida rol bor", async () => {
    const { app, admin, aziz } = await tayyorla();
    assert.equal(((await request(app).get("/v1/auth/men").set("Cookie", admin).expect(200)).body as { foydalanuvchi: { rol: string } }).foydalanuvchi.rol, "admin");
    assert.equal(((await request(app).get("/v1/auth/men").set("Cookie", aziz).expect(200)).body as { foydalanuvchi: { rol: string } }).foydalanuvchi.rol, "foydalanuvchi");
  });
}
