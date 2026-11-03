// rls.test.ts — #20 (holat 20): API HAQIQIY rollar bilan — vazifalar_api (RLS ostida, set_config) va vazifalar_auth. Shartnoma testlari pg va prisma omborlari uchun
// RLS ostida qayta; izolyatsiya (WHERE'siz so'rov ham faqat o'zinikini ko'radi), PUT begona id bilan, audit kim_id, rollar chegarasi, to'liq HTTP oqim.
import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { pgPool, PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { PrismaOmbori } from "../src/vazifalar/prisma-ombor.ts";
import { expressIlova } from "../test/yordamchi.ts";
import { omborShartnomasi } from "./ombor-shartnoma.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";

const baza = await authBaza("rls");
if (typeof baza === "string") {
  test.skip(`RLS (Postgres) — ${baza}`, () => {});
} else {
  const admin = baza; // postgres (superuser) — faqat tayyorlash va tekshirish uchun
  const url = (rol: string) => {
    const u = new URL(process.env["TEST_AUTH_DATABASE_URL"] ?? "postgres://postgres@127.0.0.1:5496/vazifalar_test_auth");
    u.username = rol;
    u.pathname = `${u.pathname}_rls`;
    return u.toString();
  };
  const api = pgPool(url("vazifalar_api"), { max: 5 });
  const auth = pgPool(url("vazifalar_auth"), { max: 3 });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url("vazifalar_api"), max: 5 }) });
  afterAll(async () => { await Promise.all([api.end(), auth.end(), prisma.$disconnect()]); await admin.end(); });
  const tayyor = async () => {
    await tozala(admin);
    await admin.query("INSERT INTO foydalanuvchilar (email, toliq_ism) VALUES ('test@example.com', 'Test'), ('boshqa@example.com', 'Boshqa')");
  };
  beforeAll(async () => {
    const { rows } = await api.query<{ u: string; s: boolean }>("SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS s");
    assert.deepEqual(rows[0], { u: "vazifalar_api", s: false });
  });

  // 25–27 shartnoma testlari — endi RLS ostida (superuser emas)
  omborShartnomasi("postgres (vazifalar_api, RLS)", async () => { await tayyor(); return new PgOmbori(api, 1); });
  omborShartnomasi("prisma (vazifalar_api, RLS)", async () => { await tayyor(); return new PrismaOmbori(prisma, 1); });

  test("izolyatsiya: set_config'siz — 0 qator; WHERE'siz so'rov ham faqat o'zinikini ko'radi; begona nomiga INSERT — RLS xatosi", async () => {
    await tayyor();
    await new PgOmbori(api, 1).yarat({ matn: "Birinchiniki" });
    await new PgOmbori(api, 2).yarat({ matn: "Ikkinchiniki" });
    assert.equal((await api.query("SELECT * FROM vazifalar")).rowCount, 0); // "yopiq holatda xavfsiz"
    const c = await api.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('ilova.foydalanuvchi_id', '2', true)");
      assert.deepEqual((await c.query<{ matn: string }>("SELECT matn FROM vazifalar")).rows.map((r) => r.matn), ["Ikkinchiniki"]);
      await assert.rejects(c.query("INSERT INTO vazifalar (egasi_id, matn) VALUES (1, 'begona nomiga')"), /row-level security/);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });

  test("PUT: berilgan id boshqa foydalanuvchiniki — yangi id beriladi (119 dan oldin: RLS uni yashirib, PK to'qnashuvi — 500)", async () => {
    await tayyor();
    const begona = await new PgOmbori(api, 2).yarat({ matn: "Ikkinchining vazifasi" });
    for (const o of [new PgOmbori(api, 1), new PrismaOmbori(prisma, 1)]) {
      const n = await o.almashtirHammasi([{ id: begona.id, matn: `Meniki ${String(Math.random())}`, bajarildi: false }]);
      assert.notEqual(n.vazifalar[0]?.id, begona.id);
    }
    assert.equal((await new PgOmbori(api, 2).ol(begona.id))?.matn, "Ikkinchining vazifasi");
  });

  test("audit: vazifa_tarixi.kim_id endi yoziladi (27 dan qolgan BACKLOG)", async () => {
    await tayyor();
    const v = await new PgOmbori(api, 2).yarat({ matn: "Tarix" });
    await new PrismaOmbori(prisma, 2).yangila(v.id, { bajarildi: true });
    const { rows } = await admin.query<{ amal: string; kim: number }>("SELECT amal, kim_id::int AS kim FROM vazifa_tarixi ORDER BY id");
    assert.ok(rows.length >= 2);
    assert.ok(rows.every((r) => r.kim === 2), JSON.stringify(rows));
  });

  test("rollar chegarasi: api — sessiyalar va MFA sirlarini O'QIY OLMAYDI; auth — vazifalarni o'qiy olmaydi", async () => {
    for (const t of ["sessiyalar", "mfa_totp", "otp_kodlar", "auth_hodisalar"]) await assert.rejects(api.query(`SELECT 1 FROM ${t} LIMIT 1`), /permission denied/, t);
    await assert.rejects(auth.query("SELECT 1 FROM vazifalar LIMIT 1"), /permission denied/);
    await assert.rejects(api.query("CREATE TABLE x (i int)"), /permission denied/);
  });

  test("to'liq HTTP oqim ikki rol bilan: ro'yxat → tasdiq → vazifa → begona id 404", async () => {
    await tozala(admin);
    const d = authBogliqliklari(auth);
    const app = await expressIlova({ ombor: (e) => new PgOmbori(api, e), auth: d });
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const dilnoza = await hisobOch(app, d, "dilnoza@example.com");
    const v = (await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "RLS ostida #test" }).expect(201)).body as { id: number };
    await request(app).get(`/v1/vazifalar/${String(v.id)}`).set("Cookie", dilnoza).expect(404);
    const t = (await request(app).get("/v1/teglar").set("Cookie", aziz).expect(200)).body as { teglar: { teg: string }[] };
    assert.deepEqual(t.teglar.map((x) => x.teg), ["test"]);
  });
}
