// nest-integratsiya.test.ts — 30 C: 29-qism integratsiyalari Nest'ga ko'chganda paydo bo'ladigan xavflar (29 testlari ularni ko'rmaydi):
//   - "yopiq sukut" C yo'llari uchun ham: anonim so'rov — 401; ochiqlari — aniq ro'yxat (one-click obuna, SMS callback);
//   - versiyasiz C yo'llari yo'q (faqat /v1);
//   - Bull Board (Express adapteri — Nest guard'i ishlamaydi, o'z tekshiruvi): anonim 401, oddiy 403, admin 200;
//   - obuna sahifasi o'z formasini yubora oladi (API'ning qat'iy CSP'si form-action 'none' — 29 da brauzer POST'ni to'sardi).
import { afterAll, beforeEach, expect, test } from "vitest";
import request from "supertest";
import { createClient } from "redis";
import { ilovaYarat } from "../src/ilova.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { Navbatlar, ulanish } from "../src/navbat/navbat.ts";
import { SseHub } from "../src/realtime/sse.ts";
import { obunaTokeni } from "../src/email/obuna.ts";
import type { FaylOmbori } from "../src/fayl/s3.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";

const REDIS = process.env["TEST_REDIS_URL"];
const baza = await authBaza("nest_integratsiya");
if (typeof baza === "string" || REDIS === undefined) {
  test.skip(`Nest integratsiyalar (Postgres + Redis) — ${typeof baza === "string" ? baza : "TEST_REDIS_URL yo'q"}`, () => {});
} else {
  const pool = baza;
  const redis = createClient({ url: REDIS });
  await redis.connect();
  const navbatlar = new Navbatlar(ulanish(REDIS), "tNI");
  const hub = new SseHub();
  const d = authBogliqliklari(pool);
  const obunaKaliti = Buffer.alloc(32, 9);
  // Bog'liqliklar to'liq; S3 — soxta (anonim so'rov handler'ga yetmaydi; autentifikatsiyali yo'llar fayl.test.ts da MinIO bilan)
  const app = await ilovaYarat({
    ombor: (e) => new PgOmbori(pool, e), auth: d, obunaKaliti, jonli: hub,
    fayllar: { ombor: {} as FaylOmbori, pool, maksHajm: 1024 },
    bildirishnoma: { pool, vapidOchiq: "test", smsKaliti: Buffer.alloc(32, 1) },
    telegram: { pool, redis, botNomi: "t_bot" },
    webhooklar: { pool, httpRuxsat: true },
    navbat: { pool, navbatlar },
  });
  const http = app.getHttpAdapter().getInstance() as Parameters<typeof request>[0];
  afterAll(async () => {
    hub.yop();
    await app.close();
    await navbatlar.yop();
    redis.destroy();
    await pool.end();
  });
  beforeEach(() => tozala(pool));

  const C_YOLLARI: [string, string][] = [
    ["post", "/v1/vazifalar/1/ilovalar"], ["get", "/v1/vazifalar/1/ilovalar"], ["get", "/v1/vazifalar/1/ilovalar.zip"], ["get", "/v1/vazifalar/1/ilovalar/1"],
    ["delete", "/v1/vazifalar/1/ilovalar/1"], ["post", "/v1/fayllar/forma"], ["post", "/v1/fayllar/1/tasdiq"],
    ["get", "/v1/bildirishnomalar"], ["post", "/v1/bildirishnomalar/oqildi"], ["get", "/v1/push/kalit"], ["post", "/v1/push/obuna"], ["delete", "/v1/push/obuna"],
    ["post", "/v1/telegram/ulash"], ["get", "/v1/telegram/ulash"], ["delete", "/v1/telegram/ulash"],
    ["post", "/v1/webhooklar"], ["get", "/v1/webhooklar"], ["delete", "/v1/webhooklar/1"], ["get", "/v1/webhooklar/1/yetkazishlar"],
    ["get", "/v1/oqim"], ["put", "/v1/vazifalar/1/muddat"], ["get", "/v1/admin/navbat/api/queues"],
  ];

  test("yopiq sukut: C yo'llari anonimga 401; ochiqlari — faqat obuna (imzoli token) va SMS callback (imzoli id) — imzosiz 404", async () => {
    const holatlar: string[] = [];
    for (const [m, y] of C_YOLLARI) holatlar.push(`${m} ${y} ${String((await request(http)[m as "get"](y).set("Origin", "http://localhost:5173")).status)}`);
    expect(holatlar.filter((h) => !h.endsWith(" 401"))).toEqual([]);
    await request(http).get("/v1/obuna/1.email.yolgon").expect(404);
    await request(http).post("/v1/sms/callback").send({ status: "DELIVRD" }).expect(404);
  });

  test("versiyasiz C yo'llari yo'q (28 #07 — yashirin yo'llar): /oqim, /webhooklar, /fayllar/forma — 404", async () => {
    await request(http).get("/oqim").expect(404);
    await request(http).get("/webhooklar").expect(404);
    await request(http).post("/fayllar/forma").expect(404);
  });

  test("Bull Board (Express adapteri): oddiy foydalanuvchi 403, admin 200 (uchala navbat)", async () => {
    const aziz = await hisobOch(http, d, "aziz@example.com");
    const admin = await hisobOch(http, d, "bekzod@example.com");
    await pool.query("UPDATE foydalanuvchilar SET rol = 'admin' WHERE email = 'bekzod@example.com'");
    await request(http).get("/v1/admin/navbat/api/queues").set("Cookie", aziz).expect(403);
    const r = await request(http).get("/v1/admin/navbat/api/queues").set("Cookie", admin).expect(200);
    expect((r.body as { queues: { name: string }[] }).queues.map((q) => q.name).sort()).toEqual(["eslatmalar", "tizim", "yetkazishlar"]);
  });

  test("one-click obuna sahifasi: CSP form-action 'self' (o'z formasini yubora oladi), API qolgan javoblari — form-action 'none'", async () => {
    const t = obunaTokeni(obunaKaliti, 1, "email");
    const r = await request(http).get(`/v1/obuna/${t}`).expect(200);
    expect(r.headers["content-type"]).toMatch(/^text\/html/);
    expect(r.headers["content-security-policy"]).toContain("form-action 'self'");
    expect((await request(http).get("/health/live")).headers["content-security-policy"]).toContain("form-action 'none'");
  });
}
