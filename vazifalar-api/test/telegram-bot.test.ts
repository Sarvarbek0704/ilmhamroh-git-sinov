// telegram-bot.test.ts — 29-qism B (holat 22): bot haqiqiy ma'lumot bilan — API'dagi deep link → /start → telegram_ulanishlar (ishchi roli),
// /vazifalar (RLS), tugma → vazifa bajarildi (IDOR yo'q), /yangi dialog (Redis saqlash) muddat bilan; toxta() — graceful shutdown.
// Soxta Bot API (lokal), auth test bazasi va Redis kerak; bo'lmasa SKIP. Haqiqiy token yo'q.
import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import { createClient } from "redis";
import request from "supertest";
import type { ConversationData, VersionedState } from "@grammyjs/conversations";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori, pgPool } from "../src/vazifalar/pg-ombor.ts";
import { toxta, vazifaBot, type BotVazifa } from "../src/telegram/bot.ts";
import { dialogSaqlash, PgVazifaManbai } from "../src/telegram/manba.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";
import { soxtaTelegram, type SoxtaTelegram } from "./soxta/telegram.ts";

// 30 C: klass modul darajasida — Vite (oxc) test ichidagi (blok ichidagi) klass maydonlarini experimentalDecorators bilan o'girganda
// "SyntaxError: Unexpected token 'const'" berdi (node:test da — 29 kanoni — muammo yo'q edi)
class Sekin extends PgVazifaManbai {
  boshlandi = 0;
  kechikish = 400;
  override async kim(): Promise<number | undefined> { this.boshlandi++; await new Promise((ok) => setTimeout(ok, this.kechikish)); return undefined; }
  override royxat(): Promise<BotVazifa[]> { return Promise.resolve([]); }
}

const TOKEN = "123456:SOXTA-faqat-lokal-mock-uchun";
const REDIS = process.env["TEST_REDIS_URL"];
const baza = await authBaza("telegram_bot");

const kutib = async <T>(f: () => T | undefined | Promise<T | undefined>, ms = 4000): Promise<T> => {
  const t0 = Date.now();
  for (;;) { const r = await f(); if (r !== undefined) return r; if (Date.now() - t0 > ms) throw new Error("kutish tugadi"); await new Promise((ok) => setTimeout(ok, 15)); }
};

if (typeof baza === "string" || REDIS === undefined) {
  test.skip(`Telegram bot (Postgres + Redis + soxta Bot API) — ${typeof baza === "string" ? baza : "TEST_REDIS_URL yo'q"}`, () => {});
} else {
  const pool = baza;
  const ishchi = pgPool(Object.assign(new URL(pool.options.connectionString ?? ""), { username: "vazifalar_ishchi" }).toString(), { max: 3 });
  const redis = createClient({ url: REDIS });
  let tg: SoxtaTelegram;
  beforeAll(async () => {
    await redis.connect();
    // Oldingi yugurishdan qolgan dialog holati (vz:tg:dialog:<chat>) yangi testni chalg'itmasin — Redis umumiy
    for (const k of await redis.keys("vz:tg:*")) await redis.del(k);
    await tozala(pool);
    tg = await soxtaTelegram({ token: TOKEN, chegara: false });
  });
  afterAll(async () => { await tg.yop(); redis.destroy(); await ishchi.end(); await pool.end(); });
  const manba = new PgVazifaManbai({ ombor: (f) => new PgOmbori(pool, f), malumot: pool, ishchi, redis });
  const d = authBogliqliklari(pool);
  const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, telegram: { pool, redis, botNomi: "vazifalar_test_bot" } });
  const soni = (chat: number) => tg.chatlar.get(chat)?.length ?? 0;
  const javob = (chat: number, oldin: number) => kutib(() => { const l = tg.chatlar.get(chat) ?? []; return l.length > oldin ? l.at(-1) : undefined; });

  test("deep link → /start → ulandi; /vazifalar; tugma → bajarildi; begona id — topilmadi; /yangi dialog (Redis) muddat bilan", async () => {
    const bot = vazifaBot(TOKEN, manba, { apiRoot: tg.url, storage: dialogSaqlash<VersionedState<ConversationData>>(redis), log: () => undefined });
    void bot.start({ timeout: 1 });
    try {
      const aziz = await hisobOch(app, d, "aziz@example.com");
      const dil = await hisobOch(app, d, "dilnoza@example.com");
      const v = (await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Non olish" }).expect(201)).body as { id: number };
      const begona = (await request(app).post("/v1/vazifalar").set("Cookie", dil).send({ matn: "Dilnozaniki" }).expect(201)).body as { id: number };
      const h = (await request(app).post("/v1/telegram/ulash").set("Cookie", aziz).expect(201)).body as { havola: string; muddatSoniya: number };
      const token = /^https:\/\/t\.me\/vazifalar_test_bot\?start=([A-Za-z0-9_-]{32})$/.exec(h.havola)?.[1] ?? assert.fail(h.havola);
      let n = soni(701); tg.yozadi(701, `/start ${token}`); assert.match((await javob(701, n)).text ?? "", /Hisob ulandi/);
      n = soni(702); tg.yozadi(702, `/start ${token}`); assert.match((await javob(702, n)).text ?? "", /eskirgan yoki ishlatilgan/); // bir martalik
      assert.deepEqual((await request(app).get("/v1/telegram/ulash").set("Cookie", aziz).expect(200)).body, { ulangan: true, faol: true });

      n = soni(701); tg.yozadi(701, "/vazifalar");
      const x = await javob(701, n);
      assert.match(x.text ?? "", /Faol vazifalar \(1\)/);
      const cb = tg.bosadi(701, x.message_id, `b:${String(v.id)}`);
      await kutib(() => tg.callbackJavob.get(cb));
      assert.equal(tg.callbackJavob.get(cb)?.["text"], "Bajarildi");
      assert.equal((await pool.query<{ b: boolean }>("SELECT bajarildi AS b FROM vazifalar WHERE id = $1", [v.id])).rows[0]?.b, true);
      const cb2 = tg.bosadi(701, x.message_id, `b:${String(begona.id)}`);
      await kutib(() => tg.callbackJavob.get(cb2));
      assert.equal(tg.callbackJavob.get(cb2)?.["text"], "Vazifa topilmadi");
      assert.equal((await pool.query<{ b: boolean }>("SELECT bajarildi AS b FROM vazifalar WHERE id = $1", [begona.id])).rows[0]?.b, false);

      n = soni(701); tg.yozadi(701, "/yangi"); assert.match((await javob(701, n)).text ?? "", /matnini yozing/);
      // dialog holati Redis'da (jarayon qayta ishga tushsa ham davom etadi). 31 #34: grammY conversations holatni handler TUGAGACH yozadi — javob
      // xabari undan oldin keladi; yuk ostida darhol tekshiruv yiqildi (holat 00, flaky) → kutib tekshiramiz
      await kutib(async () => ((await redis.keys("vz:tg:dialog:*")).length > 0 ? true : undefined));
      n = soni(701); tg.yozadi(701, "Hisobot yozish"); assert.match((await javob(701, n)).text ?? "", /Muddat\?/);
      n = soni(701); tg.yozadi(701, "28.12 18:00"); assert.match((await javob(701, n)).text ?? "", /Qo'shildi: <b>Hisobot yozish<\/b>/);
      const q = (await pool.query<{ m: Date; e: string }>("SELECT muddat AS m, egasi_id AS e FROM vazifalar WHERE matn = 'Hisobot yozish'")).rows[0];
      assert.equal(q?.m.toISOString().slice(5, 16), "12-28T13:00");
      await request(app).delete("/v1/telegram/ulash").set("Cookie", aziz).expect(204);
      n = soni(701); tg.yozadi(701, "/vazifalar"); assert.match((await javob(701, n)).text ?? "", /Hisob ulanmagan/);
    } finally {
      await toxta(bot, 2000);
    }
  });

  test("toxta(): ishlanayotgan update tugashini kutadi; vaqt tugasa — kutildi=false, qolgan=1", async () => {
    const sekin = new Sekin({ ombor: (f) => new PgOmbori(pool, f), malumot: pool, ishchi, redis });
    const bot = vazifaBot(TOKEN, sekin, { apiRoot: tg.url, log: () => undefined });
    void bot.start({ timeout: 1 });
    await kutib(() => (bot.isRunning() ? true : undefined));
    const n = soni(801);
    tg.yozadi(801, "/vazifalar");
    await kutib(() => (sekin.boshlandi > 0 ? true : undefined));
    const t0 = Date.now();
    assert.deepEqual(await toxta(bot, 5000), { kutildi: true, qolgan: 0 });
    assert.ok(Date.now() - t0 >= 100, "kutmadi");
    assert.equal(soni(801), n + 1); // javob toxta() qaytishidan OLDIN yuborildi
    assert.equal(bot.isRunning(), false);

    sekin.kechikish = 1500;
    const bot2 = vazifaBot(TOKEN, sekin, { apiRoot: tg.url, log: () => undefined });
    void bot2.start({ timeout: 1 });
    await kutib(() => (bot2.isRunning() ? true : undefined));
    const oldin = sekin.boshlandi;
    tg.yozadi(802, "/vazifalar");
    await kutib(() => (sekin.boshlandi > oldin ? true : undefined));
    assert.deepEqual(await toxta(bot2, 100), { kutildi: false, qolgan: 1 });
    await new Promise((ok) => setTimeout(ok, 1600)); // osilgan ishlov tugasin (test jarayoni toza yopilsin)
  });
}
