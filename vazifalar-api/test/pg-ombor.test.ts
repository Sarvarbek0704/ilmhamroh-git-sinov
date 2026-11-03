// pg-ombor.test.ts — PgOmbori: xotira/fayl omborlari o'tgan SHARTNOMA testlari + Postgres'ga xos holatlar.
// Baza: TEST_DATABASE_URL (sukut — lokal kanon konteyneri, vazifalar_test). Sxema oldindan qurilgan bo'lishi kerak:
//   bash sinov/26/skriptlar/qur.sh --namunasiz --baza vazifalar_test
// Baza bo'lmasa — testlar SKIP (sababi bilan), yiqilmaydi: `npm test` Postgres'siz kompyuterda ham ishlaydi.
import { afterAll, describe, test } from "vitest";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { omborShartnomasi } from "./ombor-shartnoma.ts";
import { PgOmbori, pgPool } from "../src/vazifalar/pg-ombor.ts";
import { omborOl, omborYarat } from "../src/ishga-tushir.ts";
import { configYukla } from "../src/config.ts";
import { KonfliktXatosi } from "../src/umumiy/xatolar.ts";

const URL = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres@127.0.0.1:5499/vazifalar_test";

async function ulan(): Promise<Pool | string> {
  // 10 s: raqobat testi (30 parallel yozuv, pool 5) yuklangan mashinada 2 s da `timeout exceeded when trying to connect` berdi (27-qism holat 19)
  const pool = pgPool(URL, { max: 5, connectionTimeoutMillis: 10_000 });
  try {
    await pool.query("SELECT tartib FROM vazifalar LIMIT 0"); // sxema 013 gacha qurilganmi
    return pool;
  } catch (x) {
    await pool.end();
    return `test bazasi yo'q (${URL}): ${x instanceof Error ? x.message : String(x)}`;
  }
}

/** Bo'sh ombor: hamma jadval tozalanadi, id hisoblagichlari 1 dan, bitta foydalanuvchi (id 1) */
async function tozala(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE foydalanuvchilar, vazifalar, teglar, vazifa_teglari, izohlar, vazifa_tarixi RESTART IDENTITY CASCADE");
  await pool.query("INSERT INTO foydalanuvchilar (email, toliq_ism) VALUES ('test@example.com', 'Test'), ('boshqa@example.com', 'Boshqa')");
}

const ulanish = await ulan();

if (typeof ulanish === "string") {
  test.skip(`PgOmbori — ${ulanish}`, () => {});
} else {
  const pool = ulanish;
  afterAll(() => pool.end());

  omborShartnomasi("postgres", async () => {
    await tozala(pool);
    return new PgOmbori(pool, 1);
  });

  describe("PgOmbori: Postgres'ga xos", () => {
    test("ochir — yumshoq: qator bazada qoladi, ochirilgan_vaqt qo'yiladi; ro'yxat versiyasi bazada", async () => {
      await tozala(pool);
      const o = new PgOmbori(pool, 1);
      await o.yarat({ matn: "Non #uy" });
      assert.equal((await o.ochir(1)).tur, "ok");
      const { rows } = await pool.query<{ ochirilgan: boolean; versiya: number }>("SELECT ochirilgan_vaqt IS NOT NULL AS ochirilgan, versiya FROM vazifalar WHERE id = 1");
      assert.deepEqual(rows[0], { ochirilgan: true, versiya: 2 });
      const { rows: f } = await pool.query<{ v: number }>("SELECT vazifalar_versiyasi AS v FROM foydalanuvchilar WHERE id = 1");
      assert.equal(f[0]?.v, 2); // yarat + ochir
    });

    test("teglar bazada trigger bilan (vazifa_teglari) — filtr va hisob shundan", async () => {
      await tozala(pool);
      const o = new PgOmbori(pool, 1);
      await o.yarat({ matn: "Jo'mrak #ta'mir #Uy" });
      await o.yangila(1, { matn: "Jo'mrak #ta'mir" });
      const { rows } = await pool.query<{ nom: string }>("SELECT t.nom FROM vazifa_teglari vt JOIN teglar t ON t.id = vt.teg_id WHERE vt.vazifa_id = 1 ORDER BY 1");
      assert.deepEqual(rows.map((r) => r.nom), ["#ta'mir"]);
      assert.deepEqual(await o.teglar(), [{ teg: "ta'mir", soni: 1 }]);
    });

    test("takror matn (registrga befarq) — 409 KonfliktXatosi; o'chirilgandan keyin — mumkin", async () => {
      await tozala(pool);
      const o = new PgOmbori(pool, 1);
      await o.yarat({ matn: "Non olish" });
      await assert.rejects(o.yarat({ matn: "NON OLISH" }), (x: unknown) => x instanceof KonfliktXatosi && x.holat === 409 && x.kod === "takror-matn");
      await o.ochir(1);
      // id 3, 2 emas: rad etilgan INSERT ham sequence qiymatini "yeb" qo'ydi (sequence tranzaksiyaga bo'ysunmaydi, #13)
      assert.equal((await o.yarat({ matn: "NON OLISH" })).id, 3);
    });

    test("almashtirHammasi atomik (#48): takror matn — 409, eski ro'yxat va ro'yxat versiyasi o'zgarmaydi", async () => {
      await tozala(pool);
      const o = new PgOmbori(pool, 1);
      await o.yarat({ matn: "Non" });
      await o.yarat({ matn: "Sut" });
      const hammasi = { filtr: {}, saralash: [], limit: 10, sahifa: { tur: "kursor" as const } };
      const oldin = await o.royxat(hammasi);
      await assert.rejects(o.almashtirHammasi([{ matn: "Choy", bajarildi: false }, { matn: "choy", bajarildi: true }]), (x: unknown) => x instanceof KonfliktXatosi);
      const keyin = await o.royxat(hammasi);
      assert.deepEqual(keyin.vazifalar.map((v) => v.matn), ["Non", "Sut"]);
      assert.equal(keyin.versiya, oldin.versiya);
      const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM vazifalar");
      assert.equal(rows[0]?.n, 2); // yarim yozilgan qator yo'q
    });

    test("tranzaksiya xatosidan keyin pool toza: ulanishlar qaytgan, 'idle in transaction' yo'q", async () => {
      await tozala(pool);
      const o = new PgOmbori(pool, 1);
      for (let i = 0; i < 5; i++) await assert.rejects(o.almashtirHammasi([{ matn: "x", bajarildi: false }, { matn: "X", bajarildi: false }]));
      assert.equal(pool.waitingCount, 0);
      assert.equal(pool.totalCount, pool.idleCount);
      const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE state = 'idle in transaction' AND datname = current_database()");
      assert.equal(rows[0]?.n, 0);
    });

    test("PUT ikki vazifa matnini almashtiradi (014: EXCLUDE … DEFERRABLE — tekshiruv buyruq oxirida)", async () => {
      await tozala(pool);
      const o = new PgOmbori(pool, 1);
      await o.yarat({ matn: "Non" });
      await o.yarat({ matn: "Sut" });
      const n = await o.almashtirHammasi([{ id: 1, matn: "Sut", bajarildi: false }, { id: 2, matn: "Non", bajarildi: false }]);
      assert.deepEqual(n.vazifalar.map((v) => [v.id, v.matn]), [[1, "Sut"], [2, "Non"]]);
    });

    test("raqobat (#53–#54): 30 parallel yarat — tartib takrorlanmaydi; PATCH va PUT aralash — deadlock yo'q; bitta versiya bilan 10 PATCH — 1 ok", async () => {
      await tozala(pool);
      const o = new PgOmbori(pool, 1);
      const v = await Promise.all(Array.from({ length: 30 }, (_, i) => o.yarat({ matn: `p${String(i)}` })));
      assert.equal(new Set(v.map((x) => x.tartib)).size, 30);
      await Promise.all(Array.from({ length: 60 }, (_, i) =>
        i % 5 === 0
          ? o.almashtirHammasi(Array.from({ length: 30 }, (_, j) => ({ id: j + 1, matn: `p${String(j)}`, bajarildi: (i + j) % 2 === 0 })))
          : o.yangila(1 + (i % 30), { bajarildi: i % 2 === 0 })));
      const birVersiya = (await o.ol(1))?.versiya ?? 0;
      const n = await Promise.all(Array.from({ length: 10 }, (_, i) => o.yangila(1, { matn: `t${String(i)}` }, { versiya: birVersiya })));
      assert.equal(n.filter((x) => x.tur === "ok").length, 1);
    });

    test("tranzaksiya paytida ulanish uzilsa (pg_terminate_backend): xato chaqiruvchiga, buzilgan ulanish hovuzga qaytmaydi, jarayon yiqilmaydi", async () => {
      await tozala(pool);
      const kichik = pgPool(URL, { max: 1 });
      // 27-qism holat 19: tinglovchisiz bu test ~50 % yiqilardi (4 tadan 2) — terminate xabari ulanish hovuzda BO'SH turganda kelsa,
      // pool "error" chiqaradi va tinglovchi yo'q → uncaughtException. Ilovada omborYarat tinglovchi qo'yadi; testdagi pool ham qo'ysin
      kichik.on("error", () => {});
      const o = new PgOmbori(kichik, 1);
      await o.yarat({ matn: "a" });
      const pid = (await kichik.query<{ p: number }>("SELECT pg_backend_pid() AS p")).rows[0]?.p;
      // 27-qism holat 19: avval terminate BO'SH ulanishga yuborilardi — xabar yarat()dan oldin kelsa pool ulanishni almashtirib
      // yarat() muvaffaqiyatli bo'lardi va assert.rejects yiqilardi (poyga, ~2/8). Endi deterministik: egasi qatorini boshqa ulanish
      // qulflaydi → yarat() tranzaksiya ICHIDA (ulanish olingan) kutib qoladi → shu paytda backend o'ldiriladi
      const qulf = await pool.connect();
      await qulf.query("BEGIN");
      await qulf.query("SELECT 1 FROM foydalanuvchilar WHERE id = 1 FOR UPDATE");
      const yozuv = o.yarat({ matn: "b" });
      for (let i = 0; i < 100; i++) {
        const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'", [pid]);
        if (rows[0]?.n === 1) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      await pool.query("SELECT pg_terminate_backend($1)", [pid]);
      await assert.rejects(yozuv, /terminating connection|Connection terminated/);
      await qulf.query("ROLLBACK");
      qulf.release();
      assert.equal((await o.yarat({ matn: "c" })).matn, "c"); // yangi ulanish ochildi
      await kichik.end();
    });

    test("egasi ajratilgan: boshqa foydalanuvchining vazifasi ko'rinmaydi va o'zgarmaydi", async () => {
      await tozala(pool);
      const a = new PgOmbori(pool, 1);
      const b = new PgOmbori(pool, 2);
      await a.yarat({ matn: "Azizniki" });
      assert.equal(await b.ol(1), undefined);
      assert.equal((await b.yangila(1, { bajarildi: true })).tur, "topilmadi");
      assert.equal((await b.royxat({ filtr: {}, saralash: [], limit: 10, sahifa: { tur: "kursor" } })).vazifalar.length, 0);
    });

    test("injection: qidiruv va teg — parametr, saralash maydoni — oq ro'yxat (Object.hasOwn)", async () => {
      await tozala(pool);
      const o = new PgOmbori(pool, 1);
      await o.yarat({ matn: "100% tayyor #ish" });
      await o.yarat({ matn: "Boshqa" });
      const r = (filtr: object) => o.royxat({ filtr, saralash: [], limit: 10, sahifa: { tur: "kursor" } });
      assert.equal((await r({ qidiruv: "' OR 1=1 --" })).vazifalar.length, 0);
      assert.deepEqual((await r({ qidiruv: "%" })).vazifalar.map((v) => v.id), [1]); // % — oddiy belgi, joker emas
      assert.equal((await r({ teglar: ["ish' OR '1'='1"] })).vazifalar.length, 0);
      await assert.rejects(o.royxat({ filtr: {}, saralash: [{ maydon: "constructor" as "id", kamayish: false }], limit: 10, sahifa: { tur: "kursor" } }), /oq ro'yxatda yo'q/);
    });

    test("kursor millisekundli vaqt bilan: yaratildi bo'yicha sahifalar takrorsiz va bo'shliqsiz", async () => {
      await tozala(pool);
      const o = new PgOmbori(pool, 1);
      for (let i = 0; i < 7; i++) await o.yarat({ matn: `v${String(i)}` });
      const korilgan: number[] = [];
      let keyin: (string | number | boolean)[] | undefined;
      for (;;) {
        const s = await o.royxat({ filtr: {}, saralash: [{ maydon: "yaratildi", kamayish: true }], limit: 3, sahifa: keyin === undefined ? { tur: "kursor" } : { tur: "kursor", keyin } });
        korilgan.push(...s.vazifalar.map((v) => v.id));
        if (!s.borKeyingi) break;
        keyin = s.keyingi;
      }
      assert.deepEqual([...korilgan].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
    });

    // 28-qism #07: EGASI_ID tekshiruvi olib tashlandi (egasi sessiyadan) — fail-fast endi: baza/sxema yo'q
    test("omborYarat(postgres): fail-fast — yo'q baza; config: DATABASE_URL majburiy", async () => {
      const c = configYukla({ SAQLASH: "postgres", DATABASE_URL: URL.replace(/[^/]+$/, "yoq_baza"), EGASI_ID: "1" });
      await tozala(pool);
      await assert.rejects(omborYarat(c), /does not exist/);
      assert.throws(() => configYukla({ SAQLASH: "postgres" }), /DATABASE_URL/);
      const ok = await omborYarat(configYukla({ SAQLASH: "postgres", DATABASE_URL: URL, EGASI_ID: "1" }));
      assert.equal((await omborOl(ok, 1).yarat({ matn: "config orqali" })).id, 1);
      await ok.yop();
    });

    // 27-qism holat 19 (26 kuchaytiruvchisi topgan): pool.on("error", () => {}) xatoni jim yutardi
    test("omborYarat(postgres): bo'sh ulanish uzilsa — pool xatosi log'ga yoziladi, keyingi so'rov yangi ulanishda ishlaydi", async () => {
      await tozala(pool);
      const yozildi: { err: unknown; xabar: string }[] = [];
      const s = await omborYarat(configYukla({ SAQLASH: "postgres", DATABASE_URL: `${URL}?application_name=pool-xato-testi`, EGASI_ID: "1" }), {
        error: (obj, xabar) => { yozildi.push({ err: obj.err, xabar }); },
      });
      try {
        // fail-fast so'rovidan keyin pool'da 1 ta bo'sh ulanish bor — uni boshqa ulanishdan o'ldiramiz
        await pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'pool-xato-testi' AND state = 'idle'");
        for (let i = 0; i < 50 && yozildi.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
        assert.equal(yozildi.length, 1);
        assert.match(yozildi[0]?.xabar ?? "", /bo'sh ulanish uzildi/);
        assert.match(String(yozildi[0]?.err), /terminating connection due to administrator command/);
        assert.equal((await omborOl(s, 1).yarat({ matn: "uzilishdan keyin" })).id, 1);
      } finally {
        await s.yop();
      }
    });
  });
}
