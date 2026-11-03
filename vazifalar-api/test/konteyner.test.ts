// konteyner.test.ts — #62–#65 (BT-10…13, holat 65): Testcontainers bilan HAQIQIY Postgres 18 — test o'zi konteyner ko'taradi, migratsiyalarni
// (prisma migrate deploy) qo'llaydi, snapshot (template baza) oladi, har testdan oldin restore — testlar bir-biriga ta'sir qilmaydi.
// Opt-in: TESTCONTAINERS=1 bo'lsa ishlaydi (Docker kerak, ~10 s); oddiy `npm test` da SKIP — kundalik testlar lokal baza bilan tez.
// Kanon qoidalari: konteyner nomi kanon31-tc-*, Ryuk (avtomatik tozalovchi konteyner) o'chiq — konteyner afterAll() da o'zimiz to'xtatamiz.
// Port: Testcontainers tasodifiy host portini beradi (barcha interfeyslarda) — konteyner paroli tasodifiy, test davomida yashaydi.
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Pool } from "pg";
import { pgPool, PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { omborShartnomasi } from "./ombor-shartnoma.ts";
import { fabrikaniBoshla, foydalanuvchi, vazifa } from "./fabrika.ts";

const YOQIQ = process.env["TESTCONTAINERS"] === "1";

if (!YOQIQ) {
  test.skip("Testcontainers (BT-11) — TESTCONTAINERS=1 bilan ishga tushiriladi (Docker kerak)", () => {});
} else {
  process.env["TESTCONTAINERS_RYUK_DISABLED"] = "true";
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  type Ishlayotgan = Awaited<ReturnType<InstanceType<typeof PostgreSqlContainer>["start"]>>;
  let konteyner: Ishlayotgan | undefined;
  let pool: Pool | undefined;
  const vaqtlar: Record<string, number> = {};
  let db: Pool; // joriy test bazasi (beforeEach — toza())

  beforeAll(async () => {
    let t = performance.now();
    const k = await new PostgreSqlContainer("pgvector/pgvector:pg18") // 31: sql/303 CREATE EXTENSION vector — oddiy postgres:18 da yo'q
      .withName(`kanon31-tc-${String(process.pid)}`)
      .withTmpFs({ "/var/lib/postgresql": "rw" }) // diskka yozmaydi — tezroq, to'xtaganda yo'qoladi
      .start();
    konteyner = k;
    vaqtlar["konteyner"] = performance.now() - t;
    t = performance.now();
    const r = spawnSync(process.execPath, [join("node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: k.getConnectionUri() }, encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`migrate deploy: ${r.stdout}${r.stderr}`);
    vaqtlar["migratsiya"] = performance.now() - t;
    t = performance.now();
    await k.snapshot(); // migratsiyalangan bo'sh baza → template
    vaqtlar["snapshot"] = performance.now() - t;
  }, 180_000); // 31 #34: yuklangan mashinada migratsiya 52.7 s gacha cho'zildi (30 s hook chegarasi — "10 skipped", 30-qism holat 65 da ham)

  afterAll(async () => {
    await pool?.end();
    await konteyner?.stop();
    console.log(`  [Testcontainers vaqtlari] ${Object.entries(vaqtlar).map(([k, v]) => `${k} ${v.toFixed(0)} ms`).join(", ")}`);
  });

  /** Har test toza bazada: restore (template'dan qayta yaratish) — pool'ni oldin yopish kerak (baza band bo'lsa DROP qilinmaydi) */
  async function toza(): Promise<Pool> {
    if (konteyner === undefined) throw new Error("konteyner ishga tushmagan");
    await pool?.end();
    const t = performance.now();
    await konteyner.restoreSnapshot();
    vaqtlar["restore (oxirgi)"] = performance.now() - t;
    const yangi = pgPool(konteyner.getConnectionUri(), { max: 5 });
    pool = yangi;
    return yangi;
  }

  describe("BT-11: migratsiyalar konteynerda", () => {
    beforeEach(async () => { db = await toza(); fabrikaniBoshla(); });

    test("hamma migratsiya qo'llangan, sxema obyektlari joyida (trigger, view, MV, RLS)", async () => {
      const { rows } = await db.query<{ m: string }>("SELECT migration_name AS m FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY 1");
      assert.equal(rows[0]?.m, "0_init");
      const { rows: [s] } = await db.query<{ trg: number; mv: number; rls: number }>(`SELECT
        (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal) AS trg,
        (SELECT count(*)::int FROM pg_matviews) AS mv,
        (SELECT count(*)::int FROM pg_class WHERE relrowsecurity) AS rls`);
      // 29-qism B: RLS jadvallari 28 dagi 5 + 201 (2) + 202 (4) + 203 (2)
      // 31: +3 trigger (vazifalar_hodisa — 301; audit.jurnal o'zgarmasligi ×2 — 305), +3 RLS (vazifa_hodisalari, vazifa_embeddinglar, ai_sarf)
      assert.deepEqual(s, { trg: 8, mv: 1, rls: 16 });
    });
  });

  describe("BT-13: SQL va cheklovlar (in-memory taqlid bera olmaydigan xulq)", () => {
    beforeEach(async () => { db = await toza(); fabrikaniBoshla(); });

    test("CHECK: 101 belgili matn → 23514; chetida bo'shliq → 23514", async () => {
      const f = await foydalanuvchi(db);
      await assert.rejects(vazifa(db, { egasi_id: f.id, matn: "x".repeat(101) }), { code: "23514", constraint: "vazifalar_matn_check" });
      await assert.rejects(vazifa(db, { egasi_id: f.id, matn: " a " }), { code: "23514" });
    });

    test("014 EXCLUDE: faol vazifalar orasida registrga befarq takror → 23P01; o'chirilgandan keyin — mumkin", async () => {
      const f = await foydalanuvchi(db);
      const v = await vazifa(db, { egasi_id: f.id, matn: "Non olish" });
      await assert.rejects(vazifa(db, { egasi_id: f.id, matn: "NON OLISH" }), { code: "23P01", constraint: "vazifalar_egasi_id_matn_excl" });
      await db.query("UPDATE vazifalar SET ochirilgan_vaqt = now() WHERE id = $1", [v.id]);
      assert.equal((await vazifa(db, { egasi_id: f.id, matn: "NON OLISH" })).matn, "NON OLISH");
      // boshqa foydalanuvchida — mumkin
      assert.ok(await vazifa(db, { matn: "Non olish" }));
    });

    test("trigger'lar: tartib oxiriga, versiya +1, teglar matndan, izohlar soni", async () => {
      const f = await foydalanuvchi(db);
      const a = await vazifa(db, { egasi_id: f.id, matn: "Bir #ish" });
      const b = await vazifa(db, { egasi_id: f.id, matn: "Ikki #uy #Ish" });
      assert.deepEqual([a.tartib, b.tartib], [1, 2]);
      const { rows: [u] } = await db.query<{ versiya: number }>("UPDATE vazifalar SET bajarildi = true, bajarilgan_vaqt = now() WHERE id = $1 RETURNING versiya", [a.id]);
      assert.equal(u?.versiya, 2);
      const { rows: teglar } = await db.query<{ nom: string; n: number }>("SELECT t.nom, count(*)::int AS n FROM teglar t JOIN vazifa_teglari vt ON vt.teg_id = t.id GROUP BY 1 ORDER BY 1");
      assert.deepEqual(teglar, [{ nom: "#ish", n: 2 }, { nom: "#uy", n: 1 }]);
      await db.query("INSERT INTO izohlar (vazifa_id, muallif_id, matn) VALUES ($1, $2, 'a'), ($1, $2, 'b')", [a.id, f.id]);
      const { rows: [s] } = await db.query<{ izohlar_soni: number }>("SELECT izohlar_soni FROM vazifalar WHERE id = $1", [a.id]);
      assert.equal(s?.izohlar_soni, 2);
    });

    test("FK CASCADE: foydalanuvchi o'chsa vazifalari ham; RLS: ilova roli boshqa odamning vazifasini ko'rmaydi", async () => {
      const a = await foydalanuvchi(db);
      const b = await foydalanuvchi(db);
      await vazifa(db, { egasi_id: a.id });
      await vazifa(db, { egasi_id: b.id });
      const c = await db.connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE vazifalar_ilova");
        await c.query(`SET LOCAL ilova.foydalanuvchi_id = '${String(a.id)}'`);
        const { rows: [n] } = await c.query<{ n: number }>("SELECT count(*)::int AS n FROM vazifalar");
        assert.equal(n?.n, 1);
        await c.query("ROLLBACK");
      } finally { c.release(); }
      await db.query("DELETE FROM foydalanuvchilar WHERE id = $1", [a.id]);
      const { rows: [q] } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM vazifalar");
      assert.equal(q?.n, 1);
    });
  });

  // BT-10: shartnoma testlari ham konteynerda — har test template'dan toza baza (TRUNCATE kerak emas)
  omborShartnomasi("postgres (Testcontainers)", async () => {
    const p = await toza();
    await p.query("INSERT INTO foydalanuvchilar (email, toliq_ism) VALUES ('test@example.com', 'Test')");
    return new PgOmbori(p, 1);
  });
}
