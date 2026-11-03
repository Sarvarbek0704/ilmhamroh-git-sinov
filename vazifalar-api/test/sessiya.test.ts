// sessiya.test.ts — #07 (holat 07): sessiya cookie'si, himoyalangan yo'llar, foydalanuvchilar ajratilgani (IDOR, idempotentlik, eksport),
// chiqish, barcha qurilmalardan chiqish, fixation, idle va mutlaq muddat, token bazada hash. Haqiqiy Postgres (vazifalar_test_auth), PgOmbori.
import { afterAll, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import type { RequestListener } from "node:http";
import { expressIlova } from "../test/yordamchi.ts";
import { cookieOl, tokenHash } from "../src/auth/sessiya.ts";
import type { SessiyaSozlamasi } from "../src/auth/sessiya.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { authBaza, authBogliqliklari, cookieniOl, hisobOch, PAROL, tozala, xatToken } from "./auth-yordam.ts";
import type { TestAuth } from "./auth-yordam.ts";

const baza = await authBaza("sessiya");

test("cookieOl — nomi aniq mos kelgan birinchi cookie", () => {
  assert.equal(cookieOl("a=1; __Host-sessiya=abc; b=2", "__Host-sessiya"), "abc");
  assert.equal(cookieOl("x__Host-sessiya=zz; __Host-sessiya=ok", "__Host-sessiya"), "ok");
  assert.equal(cookieOl("a=1", "__Host-sessiya"), undefined);
  assert.equal(cookieOl(undefined, "a"), undefined);
});

if (typeof baza === "string") {
  test.skip(`sessiya (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  let app: RequestListener;
  let d: TestAuth;
  const yangiIlova = async (s?: SessiyaSozlamasi) => {
    d = authBogliqliklari(pool, s);
    return await expressIlova({ ombor: (egasi) => new PgOmbori(pool, egasi), auth: d });
  };
  /** #12 dan: ro'yxat → xatdagi havola → tasdiqlash → sessiya (holat 07–11 da ro'yxatning o'zi sessiya berardi) */
  const royxat = (email: string): Promise<string> => hisobOch(app, d, email);
  beforeEach(async () => {
    await tozala(pool);
    app = await yangiIlova();
  });

  describe("cookie va kirish", () => {
    test("kirish (eslabQol) → Set-Cookie: __Host-sessiya, HttpOnly, Secure, SameSite=Lax, Path=/, Expires (~30 kun); tanada token yo'q", async () => {
      await royxat("aziz@example.com");
      const r = await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL, eslabQol: true }).expect(200);
      const c = (r.headers["set-cookie"] as unknown as string[])[0] ?? "";
      assert.match(c, /^__Host-sessiya=[A-Za-z0-9_-]{43}; Path=\/; Expires=[^;]+; HttpOnly; Secure; SameSite=Lax$/);
      const kun = (Date.parse(/Expires=([^;]+)/.exec(c)?.[1] ?? "") - Date.now()) / 86_400_000;
      assert.ok(kun > 29.9 && kun <= 30, String(kun));
      assert.ok(!JSON.stringify(r.body).includes(c.slice(15, 58)));
    });

    test("bazada token emas, sha256 hash (32 bayt); token boshqa — hash boshqa", async () => {
      const cookie = await royxat("aziz@example.com");
      const token = cookie.split("=")[1] ?? "";
      const { rows } = await pool.query<{ h: Buffer }>("SELECT token_hash AS h FROM sessiyalar");
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0]?.h, tokenHash(token));
      // qatorning hech bir ustunida (matn ko'rinishida) token yo'q
      assert.equal((await pool.query("SELECT 1 FROM sessiyalar s WHERE s::text LIKE '%' || $1 || '%'", [token.slice(0, 12)])).rowCount, 0);
    });

    test("himoyalangan yo'llar: cookie'siz → 401 kirish-kerak + WWW-Authenticate; cookie bilan → 200; /men", async () => {
      for (const y of ["/v1/vazifalar", "/v1/teglar", "/vazifalar", "/v1/eksportlar/x"]) {
        const r = await request(app).get(y).expect(401);
        assert.equal((r.body as { kod: string }).kod, "kirish-kerak", y);
        assert.equal(r.headers["www-authenticate"], 'Cookie realm="vazifalar"');
      }
      await request(app).get("/v1/auth/men").expect(401);
      const cookie = await royxat("aziz@example.com");
      await request(app).get("/v1/vazifalar").set("Cookie", cookie).expect(200);
      const men = await request(app).get("/v1/auth/men").set("Cookie", cookie).expect(200);
      assert.equal((men.body as { foydalanuvchi: { email: string } }).foydalanuvchi.email, "aziz@example.com");
    });

    test("soxta / buzilgan cookie — 401 (bazaga noto'g'ri shakl bormaydi)", async () => {
      await royxat("aziz@example.com");
      for (const c of ["__Host-sessiya=" + "A".repeat(43), "__Host-sessiya=' OR 1=1 --", "__Host-sessiya=", "sessiya=" + "A".repeat(43)]) {
        await request(app).get("/v1/vazifalar").set("Cookie", c).expect(401);
      }
    });

    test("COOKIE_SECURE=false — nomi `sessiya` (`__Host-` Secure'siz bo'lmaydi), Secure yo'q", async () => {
      const a = await yangiIlova({ idleMs: 3_600_000, muddatMs: 86_400_000, qisqaIdleMs: 60_000, qisqaMuddatMs: 3_600_000, secure: false });
      await request(a).post("/v1/auth/royxat").send({ email: "a@example.com", toliqIsm: "Aa", parol: PAROL }).expect(202);
      await request(a).post("/v1/auth/email-tasdiq").send({ token: await xatToken(d) }).expect(200);
      const r = await request(a).post("/v1/auth/kirish").send({ email: "a@example.com", parol: PAROL, eslabQol: true }).expect(200);
      const c = (r.headers["set-cookie"] as unknown as string[])[0] ?? "";
      assert.match(c, /^sessiya=[^;]+; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/);
      await request(a).get("/v1/vazifalar").set("Cookie", cookieniOl(c, "sessiya")).expect(200);
    });
  });

  describe("foydalanuvchilar ajratilgan (IDOR / BOLA)", () => {
    test("Aziz va Dilnoza: har biri faqat o'z vazifalari; begona id — 404 (403 emas); PATCH/DELETE begonaga — 404", async () => {
      const aziz = await royxat("aziz@example.com");
      const dilnoza = await royxat("dilnoza@example.com");
      const v = (await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Azizniki #maxfiy" }).expect(201)).body as { id: number };
      await request(app).post("/v1/vazifalar").set("Cookie", dilnoza).send({ matn: "Dilnozaniki" }).expect(201);
      const royxatD = (await request(app).get("/v1/vazifalar").set("Cookie", dilnoza).expect(200)).body as { vazifalar: { matn: string }[] };
      assert.deepEqual(royxatD.vazifalar.map((x) => x.matn), ["Dilnozaniki"]);
      await request(app).get(`/v1/vazifalar/${String(v.id)}`).set("Cookie", dilnoza).expect(404);
      await request(app).patch(`/v1/vazifalar/${String(v.id)}`).set("Cookie", dilnoza).send({ bajarildi: true }).expect(404);
      await request(app).delete(`/v1/vazifalar/${String(v.id)}`).set("Cookie", dilnoza).expect(404);
      assert.deepEqual(((await request(app).get("/v1/teglar").set("Cookie", dilnoza).expect(200)).body as { teglar: unknown[] }).teglar, []);
      assert.equal(((await request(app).get(`/v1/vazifalar/${String(v.id)}`).set("Cookie", aziz).expect(200)).body as { bajarildi: boolean }).bajarildi, false);
    });

    test("Idempotency-Key — foydalanuvchi bo'yicha: Dilnoza Azizning kalitini ishlatsa Azizning javobini OLMAYDI", async () => {
      const aziz = await royxat("aziz@example.com");
      const dilnoza = await royxat("dilnoza@example.com");
      const a = await request(app).post("/v1/vazifalar").set("Cookie", aziz).set("Idempotency-Key", "kalit-123").send({ matn: "Bir xil matn" }).expect(201);
      const d = await request(app).post("/v1/vazifalar").set("Cookie", dilnoza).set("Idempotency-Key", "kalit-123").send({ matn: "Bir xil matn" });
      assert.equal(d.headers["idempotency-replayed"], undefined, "Azizning saqlangan javobi Dilnozaga qaytdi");
      assert.equal(d.status, 201);
      assert.notEqual((d.body as { id: number }).id, (a.body as { id: number }).id);
      // o'zining takrori — o'sha javob
      const a2 = await request(app).post("/v1/vazifalar").set("Cookie", aziz).set("Idempotency-Key", "kalit-123").send({ matn: "Bir xil matn" }).expect(201);
      assert.equal(a2.headers["idempotency-replayed"], "true");
    });

    test("eksport ishi — faqat yaratgan foydalanuvchiga (begona — 404)", async () => {
      const aziz = await royxat("aziz@example.com");
      const dilnoza = await royxat("dilnoza@example.com");
      await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Azizniki" }).expect(201);
      const e = await request(app).post("/v1/eksportlar").set("Cookie", aziz).send({ format: "json" }).expect(202);
      const joy = String(e.headers.location);
      for (let i = 0; i < 50; i++) {
        if (((await request(app).get(joy).set("Cookie", aziz)).body as { holat: string }).holat === "tayyor") break;
        await new Promise((r) => setTimeout(r, 10));
      }
      await request(app).get(joy).set("Cookie", dilnoza).expect(404);
      await request(app).get(`${joy}/fayl`).set("Cookie", dilnoza).expect(404);
      const f = await request(app).get(`${joy}/fayl`).set("Cookie", aziz).expect(200);
      assert.match(f.text, /Azizniki/);
    });

    test("yashirin yo'llar yo'q: /eksportlar, /auth versiyasiz — 404 (faqat /vazifalar, /teglar eski yo'l sifatida qoldi)", async () => {
      const aziz = await royxat("aziz@example.com");
      await request(app).post("/eksportlar").set("Cookie", aziz).send({ format: "json" }).expect(404);
      await request(app).post("/auth/kirish").send({ email: "aziz@example.com", parol: PAROL }).expect(404);
      const eski = await request(app).get("/vazifalar").set("Cookie", aziz).expect(200);
      assert.ok(eski.headers["deprecation"]);
    });
  });

  describe("chiqish, fixation, muddatlar", () => {
    test("chiqish: sessiya bazada bekor, cookie o'chiriladi (Expires 1970), eski cookie bilan — 401; sessiyasiz chiqish ham 204", async () => {
      const c = await royxat("aziz@example.com");
      const r = await request(app).post("/v1/auth/chiqish").set("Cookie", c).expect(204);
      assert.match((r.headers["set-cookie"] as unknown as string[])[0] ?? "", /^__Host-sessiya=; Path=\/; Expires=Thu, 01 Jan 1970/);
      await request(app).get("/v1/vazifalar").set("Cookie", c).expect(401);
      assert.equal((await pool.query("SELECT 1 FROM sessiyalar WHERE bekor_vaqti IS NOT NULL")).rowCount, 1);
      await request(app).post("/v1/auth/chiqish").expect(204);
    });

    test("barcha qurilmalardan chiqish: 3 sessiya → hammasi 401", async () => {
      await royxat("aziz@example.com");
      const kir = async () => cookieniOl((await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL }).expect(200)).headers["set-cookie"]);
      const [a, b, c] = [await kir(), await kir(), await kir()];
      const r = await request(app).post("/v1/auth/chiqish-hammasi").set("Cookie", b).expect(200);
      assert.equal((r.body as { bekorQilindi: number }).bekorQilindi, 4); // ro'yxatdagi + 3 kirish
      for (const x of [a, b, c]) await request(app).get("/v1/vazifalar").set("Cookie", x).expect(401);
    });

    test("session fixation: hujumchi qo'ygan (o'zining haqiqiy) cookie bilan qurbon kirsa — YANGI token, eski bekor", async () => {
      await royxat("aziz@example.com");
      const hujumchi = await royxat("hujumchi@example.com");
      const r = await request(app).post("/v1/auth/kirish").set("Cookie", hujumchi).send({ email: "aziz@example.com", parol: PAROL }).expect(200);
      const yangi = cookieniOl(r.headers["set-cookie"]);
      assert.notEqual(yangi, hujumchi);
      await request(app).get("/v1/auth/men").set("Cookie", hujumchi).expect(401); // hujumchining cookie'si endi hech narsaga yaramaydi
      const men = await request(app).get("/v1/auth/men").set("Cookie", yangi).expect(200);
      assert.equal((men.body as { foydalanuvchi: { email: string } }).foydalanuvchi.email, "aziz@example.com");
    });

    test("idle: oxirgi faollik idle'dan eski — 401; mutlaq muddat o'tgan (faol bo'lsa ham) — 401", async () => {
      const c = await royxat("aziz@example.com");
      await pool.query("UPDATE sessiyalar SET oxirgi_faollik = now() - interval '7 days 1 minute'");
      await request(app).get("/v1/vazifalar").set("Cookie", c).expect(401);
      const c2 = cookieniOl((await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL }).expect(200)).headers["set-cookie"]);
      await pool.query("UPDATE sessiyalar SET yaratilgan_vaqt = now() - interval '31 days', tugash_vaqti = now() - interval '1 second', oxirgi_faollik = now() WHERE bekor_vaqti IS NULL");
      await request(app).get("/v1/vazifalar").set("Cookie", c2).expect(401);
    });

    test("oxirgi_faollik har so'rovda yozilmaydi — 60 s dan eski bo'lsa yangilanadi", async () => {
      const c = await royxat("aziz@example.com");
      const vaqt = async () => (await pool.query<{ t: Date }>("SELECT oxirgi_faollik AS t FROM sessiyalar")).rows[0]?.t.getTime() ?? 0;
      const t0 = await vaqt();
      await request(app).get("/v1/vazifalar").set("Cookie", c).expect(200);
      assert.equal(await vaqt(), t0);
      await pool.query("UPDATE sessiyalar SET oxirgi_faollik = now() - interval '2 minutes'");
      const eski = await vaqt();
      await request(app).get("/v1/vazifalar").set("Cookie", c).expect(200);
      assert.ok((await vaqt()) > eski + 60_000);
    });

    test("#11 meni eslab qol: belgilanmasa — Expires'siz cookie, idle 12 soat, mutlaq 7 kun; belgilansa — 30 kun / 7 kun", async () => {
      await royxat("aziz@example.com");
      const kir = async (eslabQol?: boolean) => request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL, ...(eslabQol === undefined ? {} : { eslabQol }) }).expect(200);
      const q = await kir();
      assert.match((q.headers["set-cookie"] as unknown as string[])[0] ?? "", /^__Host-sessiya=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
      const u = await kir(true);
      assert.match((u.headers["set-cookie"] as unknown as string[])[0] ?? "", /Expires=/);
      // ms × interval '1 millisecond' — natija soatlarda ("168:00:00", "7 days" emas): interval kun va soatni alohida saqlaydi
      const { rows } = await pool.query<{ e: boolean; idle: string; kun: number }>(
        "SELECT eslab_qol AS e, idle_muddat::text AS idle, round(extract(epoch FROM tugash_vaqti - yaratilgan_vaqt) / 86400)::int AS kun FROM sessiyalar ORDER BY id DESC LIMIT 2");
      assert.deepEqual(rows, [{ e: true, idle: "168:00:00", kun: 30 }, { e: false, idle: "12:00:00", kun: 7 }]);
      // eslab qolinmagan: 13 soat jim tursa — tugaydi; eslab qolingani — tirik (sliding: har so'rovda suriladi)
      await pool.query("UPDATE sessiyalar SET oxirgi_faollik = now() - interval '13 hours'");
      await request(app).get("/v1/auth/men").set("Cookie", cookieniOl(q.headers["set-cookie"])).expect(401);
      await request(app).get("/v1/auth/men").set("Cookie", cookieniOl(u.headers["set-cookie"])).expect(200);
    });

    test("#11 qurilmalar: ro'yxat (joriy belgilangan, token yo'q), bittasini bekor qilish; begona sessiya — 404", async () => {
      const telefon = await royxat("aziz@example.com");
      const kompyuter = cookieniOl((await request(app).post("/v1/auth/kirish").set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0").send({ email: "aziz@example.com", parol: PAROL }).expect(200)).headers["set-cookie"]);
      const dilnoza = await royxat("dilnoza@example.com");
      const l = (await request(app).get("/v1/auth/sessiyalar").set("Cookie", kompyuter).expect(200)).body as { sessiyalar: { id: number; joriy: boolean; qurilma: string }[] };
      assert.equal(l.sessiyalar.length, 2);
      assert.deepEqual(l.sessiyalar.filter((x) => x.joriy).map((x) => x.qurilma), ["Chrome, Windows"]);
      assert.ok(!JSON.stringify(l).includes(kompyuter.split("=")[1] ?? "?"));
      const telefonId = l.sessiyalar.find((x) => !x.joriy)?.id ?? 0;
      const dilnozaId = ((await request(app).get("/v1/auth/men").set("Cookie", dilnoza).expect(200)).body as { sessiya: { id: number } }).sessiya.id;
      await request(app).delete(`/v1/auth/sessiyalar/${String(dilnozaId)}`).set("Cookie", kompyuter).expect(404); // IDOR
      await request(app).get("/v1/auth/men").set("Cookie", dilnoza).expect(200);
      await request(app).delete(`/v1/auth/sessiyalar/${String(telefonId)}`).set("Cookie", kompyuter).expect(204);
      await request(app).get("/v1/auth/men").set("Cookie", telefon).expect(401);
      await request(app).get("/v1/auth/men").set("Cookie", kompyuter).expect(200);
      await request(app).delete("/v1/auth/sessiyalar/abc").set("Cookie", kompyuter).expect(400);
    });

    test("jurnal: royxat, kirish, chiqish hodisalari", async () => {
      const c = await royxat("aziz@example.com");
      await request(app).post("/v1/auth/chiqish").set("Cookie", c).expect(204);
      const { rows } = await pool.query<{ tur: string }>("SELECT tur FROM auth_hodisalar ORDER BY id");
      assert.deepEqual(rows.map((r) => r.tur), ["royxat", "email_tasdiq", "chiqish"]);
    });
  });
}
