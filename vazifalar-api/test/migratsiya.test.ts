// migratsiya.test.ts — holat 40: migratsiyaHolati (mos / kutilmoqda / yiqilgan / nomalum) va koddagi migratsiyalar ro'yxati.
// Baza: TEST_DATABASE_URL serveridagi vaqtinchalik `vazifalar_test_mig` (test o'zi yaratadi va o'chiradi). Server yo'q — SKIP.
import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import pg from "pg";
import { koddagiMigratsiyalar, migratsiyaHolati } from "../src/umumiy/migratsiya.ts";

const ASOS = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres@127.0.0.1:5498/vazifalar_test";
const admin = new pg.Client({ connectionString: ASOS.replace(/\/[^/]+$/, "/postgres") });
const ulandi = await admin.connect().then(() => true, () => false);
let pool: pg.Pool;

if (!ulandi) {
  test.skip("migratsiyaHolati — Postgres yo'q", () => {});
} else {
  beforeAll(async () => {
    await admin.query("DROP DATABASE IF EXISTS vazifalar_test_mig WITH (FORCE)");
    await admin.query("CREATE DATABASE vazifalar_test_mig");
    pool = new pg.Pool({ connectionString: ASOS.replace(/\/[^/]+$/, "/vazifalar_test_mig"), max: 2 });
  });
  afterAll(async () => {
    await pool.end();
    // 30-qism holat 06 da topilgan flaky (27 da ham bor edi): pool.end() mijoz soketi YOPILISHINI kutmaydi — darhol `DROP … WITH (FORCE)`
    // o'sha seansni o'ldiradi, mijozga FATAL 57P01 keladi, tinglovchisi yo'q → ushlanmagan xato (Vitest: "Unhandled Errors", exit 1).
    // FORCE'siz: seans hali bo'lsa 55006 — qisqa kutib qayta urinamiz
    for (let i = 0; ; i++) {
      try {
        await admin.query("DROP DATABASE IF EXISTS vazifalar_test_mig");
        break;
      } catch (x) {
        if (i >= 40 || (x as { code?: string }).code !== "55006") throw x;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await admin.end();
  }, 60_000); // 31 #34: DROP DATABASE checkpoint kutadi — parallel yuk ostida 30 s hook chegarasidan oshdi (holat 00)

  test("koddagi migratsiyalar: prisma/migrations papkalari, tartib bilan, migration_lock.toml'siz", async () => {
    const m = await koddagiMigratsiyalar();
    assert.equal(m[0], "0_init");
    assert.ok(m.length >= 3);
    assert.deepEqual([...m].sort(), m);
  });

  test("migratsiyaHolati: jadval yo'q → nomalum; hammasi bor → mos; yetishmasa → kutilmoqda; finished_at NULL → yiqilgan", async () => {
    const kod = ["0_init", "1_a", "2_b"];
    assert.equal((await migratsiyaHolati(pool, kod)).tur, "nomalum");
    await pool.query("CREATE TABLE _prisma_migrations (migration_name text, finished_at timestamptz, rolled_back_at timestamptz)");
    await pool.query("INSERT INTO _prisma_migrations VALUES ('0_init', now(), NULL), ('1_a', now(), NULL)");
    assert.deepEqual(await migratsiyaHolati(pool, kod), { tur: "kutilmoqda", nomlar: ["2_b"] });
    await pool.query("INSERT INTO _prisma_migrations VALUES ('2_b', NULL, NULL)");
    assert.deepEqual(await migratsiyaHolati(pool, kod), { tur: "yiqilgan", nomlar: ["2_b"] });
    // resolve --rolled-back dan keyin qayta qo'llangan
    await pool.query("UPDATE _prisma_migrations SET rolled_back_at = now() WHERE migration_name = '2_b'");
    await pool.query("INSERT INTO _prisma_migrations VALUES ('2_b', now(), NULL)");
    assert.deepEqual(await migratsiyaHolati(pool, kod), { tur: "mos", soni: 3 });
  });
}
