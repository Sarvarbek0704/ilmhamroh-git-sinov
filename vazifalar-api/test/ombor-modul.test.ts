// ombor-modul.test.ts — holat 14: OmborModule.forRootAsync() (async fabrika provider, #09/#12) va lifecycle (#13):
// config bo'yicha ombor DI ichida yaratiladi, fail-fast xato Promise orqali chiqadi, app.close() pool ulanishlarini yopadi
import { afterAll, describe, test } from "vitest";
import assert from "node:assert/strict";
import pg from "pg";
import { ilovaYarat } from "../src/ilova.ts";
import { configYukla, ConfigXatosi } from "../src/config.ts";
import { VAZIFA_OMBORI } from "../src/tokenlar.ts";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";
import request from "supertest";
import { xotiraLogi } from "./yordamchi.ts";

test("SAQLASH=xotira: ombor config'dan (fabrika) — XotiraOmbori, HTTP ishlaydi", async () => {
  const app = await ilovaYarat({ config: configYukla({ SAQLASH: "xotira" }) });
  assert.ok(app.get(VAZIFA_OMBORI) instanceof XotiraOmbori);
  await app.close();
});

test("holat 30: hech narsa berilmasa — config process.env dan (ConfigModule); env xato — ConfigXatosi, ilova yaratilmaydi", async () => {
  const app = await ilovaYarat({});
  assert.ok(app.get(VAZIFA_OMBORI) instanceof XotiraOmbori); // test muhitida SAQLASH yo'q — xotira
  await app.close();
  const asl = process.env["PORT"];
  process.env["PORT"] = "abc";
  try {
    await assert.rejects(ilovaYarat({}), (x: unknown) => x instanceof ConfigXatosi && /PORT/.test(x.message));
  } finally {
    if (asl === undefined) delete process.env["PORT"];
    else process.env["PORT"] = asl;
  }
});

// namuna bazasi (qur.sh, Aziz — id 1): test bazalarini pg/prisma testlari parallel TRUNCATE qiladi — bu yerda faqat o'qiladi
const URL = process.env["TEST_NAMUNA_DATABASE_URL"] ?? "postgres://postgres@127.0.0.1:5496/vazifalar";
const admin = new pg.Pool({ connectionString: URL, max: 1 });
const bor = await admin.query("SELECT 1").then(() => true, () => false);

if (!bor) {
  test.skip(`OmborModule (postgres) — baza yo'q (${URL})`, () => {});
} else {
  afterAll(() => admin.end());
  /** namuna bazasi: Aziz, demo parol (sql/110) → sessiya cookie'si */
  const kirish = async (http: Parameters<typeof request>[0]): Promise<string> => {
    const r = await request(http).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: "Bahor-choyxona-2026" }).expect(200);
    return ((r.headers["set-cookie"] as unknown as string[])[0] ?? "").split(";")[0] ?? "";
  };
  const ulanishlar = async () => (await admin.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'vazifalar-api' AND datname = current_database()")).rows[0]?.n ?? -1;

  describe("OmborModule.forRootAsync (postgres)", () => {
    // B (28 #07): EGASI_ID tekshiruvi olib tashlandi — postgres/prisma'da egasi sessiyadan; config'dan auth yoqiladi ("yopiq sukut")
    test("B: SAQLASH=postgres — auth config'dan yoqiladi: sessiyasiz 401, namuna paroli bilan kirish → o'z vazifalari; versiyasiz /auth yo'q (404)", async () => {
      const app = await ilovaYarat({ config: configYukla({ SAQLASH: "postgres", DATABASE_URL: URL, EGASI_ID: "999999", LOG_LEVEL: "silent" }) });
      const http = app.getHttpServer();
      await request(http).get("/v1/vazifalar").expect(401);
      const c = await kirish(http);
      const r = await request(http).get("/v1/vazifalar?limit=1").set("Cookie", c).expect(200);
      assert.equal(r.headers["ratelimit-policy"], "600;w=60");
      await request(http).post("/auth/kirish").send({ email: "aziz@example.com", parol: "Bahor-choyxona-2026" }).expect(404);
      await app.close();
    });

    test("app.close() → onApplicationShutdown: pool yopiladi (pg_stat_activity'da ulanish qolmaydi)", async () => {
      const { log, qatorlar } = xotiraLogi();
      const app = await ilovaYarat({ config: configYukla({ SAQLASH: "postgres", DATABASE_URL: URL, EGASI_ID: "1" }), log });
      assert.ok((await ulanishlar()) >= 1);
      await app.close();
      // pool.end() soket yopilishini kutmaydi (holat 06 topilmasi) — server tomonida seans bir lahza qolishi mumkin
      let n = await ulanishlar();
      for (let i = 0; i < 40 && n > 0; i++) {
        await new Promise((r) => setTimeout(r, 50));
        n = await ulanishlar();
      }
      assert.equal(n, 0);
      assert.ok(qatorlar.some((q) => q.msg === "ombor ulanishlari yopildi"));
    });

    // holat 36 regressiyasi (#35): avval [A, B, A-takror] → 409, lekin A va B bazada qolardi (yarim yozuv)
    test("POST /toplam takror matn bilan — 207, har element o'z statusi (201, 201, 409); yaratilganlar ro'yxatda", async () => {
      const app = await ilovaYarat({ config: configYukla({ SAQLASH: "postgres", DATABASE_URL: URL, EGASI_ID: "1", LOG_LEVEL: "silent" }) });
      const http = app.getHttpServer();
      const tag = `t36-${String(Date.now())}`;
      const c = await kirish(http);
      const r = await request(http).post("/v1/vazifalar/toplam").set("Cookie", c).send({ vazifalar: [{ matn: `${tag} A` }, { matn: `${tag} B` }, { matn: `${tag.toUpperCase()} A` }] });
      assert.equal(r.status, 207);
      const natijalar = (r.body as { natijalar: { holat: number; vazifa?: { id: number } }[] }).natijalar;
      assert.deepEqual(natijalar.map((n) => n.holat), [201, 201, 409]);
      for (const n of natijalar) if (n.vazifa !== undefined) await request(http).delete(`/v1/vazifalar/${String(n.vazifa.id)}`).set("Cookie", c).expect(204);
      await app.close();
    });
  });
}
