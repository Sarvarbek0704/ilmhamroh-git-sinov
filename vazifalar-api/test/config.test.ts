import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { configYukla, ConfigXatosi } from "../src/config.ts";

test("config: sukut qiymatlar, turlar, muzlatilgan", () => {
  const c = configYukla({});
  assert.equal(c.PORT, 3000);
  assert.equal(c.HOST, "127.0.0.1");
  assert.deepEqual(c.CORS_ORIGINS, []);
  assert.equal(c.SAQLASH, "xotira");
  assert.equal(c.TRUST_PROXY, false);
  assert.equal(c.APP_TZ, "Asia/Tashkent");
  assert.ok(Object.isFrozen(c));
  const d = configYukla({ PORT: "4100", CORS_ORIGINS: "http://localhost:5173, https://login.github.io", TRUST_PROXY: "1", HSTS: "true" });
  assert.equal(d.PORT, 4100);
  assert.deepEqual(d.CORS_ORIGINS, ["http://localhost:5173", "https://login.github.io"]);
  assert.equal(d.TRUST_PROXY, 1);
  assert.equal(d.HSTS, true);
});

test("config: noto'g'ri qiymat — ConfigXatosi, hammasi bitta xabarda (prettifyError), qiymat oshkor qilinmaydi", () => {
  assert.throws(
    () => configYukla({ PORT: "yuz", SAQLASH: "mongo", CORS_ORIGINS: "maxfiy-qiymat", APP_TZ: "Toshkent" }),
    (x: unknown) => {
      assert.ok(x instanceof ConfigXatosi);
      for (const nom of ["PORT", "SAQLASH", "CORS_ORIGINS", "APP_TZ"]) assert.match(x.message, new RegExp(`at ${nom}`));
      assert.doesNotMatch(x.message, /maxfiy-qiymat/);
      return true;
    },
  );
  assert.throws(() => configYukla({ NODE_ENV: "production" }), /production'da CORS_ORIGINS majburiy/);
  // 28-qism #12 → 29-qism B (holat 13): production'da SMTP_HOST majburiy (aks holda havolalar log'ga); #07: production'da xotira/fayl va COOKIE_SECURE=false — rad
  assert.throws(() => configYukla({ NODE_ENV: "production", CORS_ORIGINS: "https://a.example", SAQLASH: "xotira", COOKIE_SECURE: "false" }),
    (x: Error) => /SMTP_HOST majburiy/.test(x.message) && /SAQLASH=postgres yoki prisma/.test(x.message) && /COOKIE_SECURE=false/.test(x.message));
  // 29-qism B (holat 13): SMTP bilan production ochildi; SMTP_USER parolsiz — rad
  const prod = { NODE_ENV: "production", CORS_ORIGINS: "https://a.example", SAQLASH: "postgres", DATABASE_URL: "postgres://x@db/v", SMTP_HOST: "smtp.example.uz" };
  assert.equal(configYukla(prod).SMTP_PORT, 587);
  assert.throws(() => configYukla({ ...prod, SMTP_USER: "api" }), /SMTP_USER va SMTP_PASS birga/);
});

// 27-qism holat 19 — 25-qism mashqi bo'lgan teshiklar (regressiya)
test("config: bo'sh raqamli qiymat (PORT=, PG_STATEMENT_TIMEOUT=) — xato, jim 0 emas", () => {
  assert.throws(() => configYukla({ PORT: "" }), /at PORT/);
  assert.throws(() => configYukla({ PG_STATEMENT_TIMEOUT: "" }), /at PG_STATEMENT_TIMEOUT/);
  assert.throws(() => configYukla({ PORT: " 80" }), /at PORT/);
  assert.throws(() => configYukla({ PORT: "70000" }), /at PORT/);
  assert.equal(configYukla({ PORT: "0" }).PORT, 0); // aniq 0 — ataylab (testlar tasodifiy port oladi)
});

test("config: CORS_ORIGINS — oxiridagi / origin'ga normallanadi, yo'lli URL rad etiladi", () => {
  assert.deepEqual(configYukla({ CORS_ORIGINS: "https://login.github.io/, http://localhost:5173" }).CORS_ORIGINS, ["https://login.github.io", "http://localhost:5173"]);
  assert.deepEqual(configYukla({ CORS_ORIGINS: "HTTPS://Login.GitHub.io:443/" }).CORS_ORIGINS, ["https://login.github.io"]);
  assert.throws(() => configYukla({ CORS_ORIGINS: "https://login.github.io/vazifalar/" }), /faqat origin/);
  assert.throws(() => configYukla({ CORS_ORIGINS: "https://login.github.io/?a=1" }), /faqat origin/);
});

test("config: REDIS_URL (ixtiyoriy, faqat redis://), KESH_TTL (sukut 60, bo'sh — xato)", () => {
  assert.equal(configYukla({}).REDIS_URL, undefined);
  assert.equal(configYukla({}).KESH_TTL, 60);
  assert.equal(configYukla({ REDIS_URL: "redis://127.0.0.1:6380" }).REDIS_URL, "redis://127.0.0.1:6380");
  assert.throws(() => configYukla({ REDIS_URL: "http://127.0.0.1:6380" }), /at REDIS_URL/);
  assert.throws(() => configYukla({ KESH_TTL: "" }), /at KESH_TTL/);
});

// 30 B BACKLOG 4: .env.example — nusxa olinib ishlatiladigan namuna. Superuser (postgres) bilan ulanish RLS'ni chetlab o'tadi (BYPASSRLS)
test(".env.example: ochiq qiymatlar config'dan o'tadi; izohdagi DATABASE_URL — vazifalar_api, AUTH_DATABASE_URL — vazifalar_auth (superuser emas)", () => {
  const qatorlar = readFileSync(new URL("../.env.example", import.meta.url), "utf8").split(/\r?\n/);
  const ochiq = Object.fromEntries(qatorlar.filter((q) => /^[A-Z_]+=/.test(q)).map((q) => [q.slice(0, q.indexOf("=")), q.slice(q.indexOf("=") + 1)]));
  assert.doesNotThrow(() => configYukla(ochiq));
  const izohda = Object.fromEntries(qatorlar.filter((q) => /^# [A-Z_]+=/.test(q)).map((q) => [q.slice(2, q.indexOf("=")), q.slice(q.indexOf("=") + 1)]));
  for (const [kalit, rol] of [["DATABASE_URL", "vazifalar_api"], ["AUTH_DATABASE_URL", "vazifalar_auth"], ["ISHCHI_DATABASE_URL", "vazifalar_ishchi"]] as const) {
    const url = new URL(izohda[kalit] ?? "postgres://yoq@x/y");
    assert.equal(url.username, rol, kalit);
    assert.equal(url.password, "", `${kalit}: namunada parol bo'lmasin`);
  }
  // hech bir qiymat superuser bilan emas
  assert.ok(!qatorlar.some((q) => /postgres:\/\/postgres[@:]/.test(q)));
});
