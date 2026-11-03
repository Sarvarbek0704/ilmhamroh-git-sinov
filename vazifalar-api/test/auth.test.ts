// auth.test.ts — #05 (holat 05): ro'yxat va login oqimi, hisob xavfsizligi (enumeration, timing, jurnal, rehash, mass assignment).
import { afterAll, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";
import { parolHash } from "../src/auth/parol.ts";
import { taqiqlanganmi } from "../src/auth/taqiqlangan-parollar.ts";
import { authBaza, authBogliqliklari, PAROL, tozala } from "./auth-yordam.ts";

const baza = await authBaza("auth");

test("taqiqlangan parollar — ro'yxat, takror, ketma-ketlik, shaxsiy ma'lumot, xizmat nomi", () => {
  assert.match(taqiqlanganmi("QwertyuiopASDFGH") ?? "", /keng tarqalgan/);
  assert.match(taqiqlanganmi("aaaaaaaaaaaaaaaaab") ?? "", /turli belgilar/);
  assert.match(taqiqlanganmi("abcdefghijklmnopq") ?? "", /ketma-ketlik/);
  assert.match(taqiqlanganmi("98765432109876543") ?? "", /turli|ketma/);
  assert.match(taqiqlanganmi("mening-vazifalar-parolim") ?? "", /xizmat nomi/);
  assert.match(taqiqlanganmi("dilnoza-rahimova-1990", ["dilnoza@example.com", "Dilnoza Rahimova"]) ?? "", /email yoki ismingiz/);
  assert.equal(taqiqlanganmi(PAROL, ["aziz@example.com", "Aziz Karimov"]), undefined);
});

if (typeof baza === "string") {
  test.skip(`auth (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  const deps = authBogliqliklari(pool);
  // Nest: ilova bir marta (28 da har so'rovga yangi Express — arzon edi; Nest bootstrap ~50 ms). Holat — bazada va deps'da, ilovada emas
  const app = await expressIlova({ ombor: new XotiraOmbori(), auth: deps, trustProxy: true });
  const ilova = () => app;
  const hodisalar = async () => (await pool.query<{ tur: string; foydalanuvchi_id: number | null; sabab: string | null; ip: string | null }>(
    "SELECT tur, foydalanuvchi_id, tafsilot->>'sabab' AS sabab, host(ip) AS ip FROM auth_hodisalar ORDER BY id")).rows;

  describe("POST /v1/auth/royxat", () => {
    beforeEach(() => tozala(pool));

    test("202 (#12: sessiyasiz, bir xil matn) — hisob tasdiqlanmagan, parol hash bazada, tasdiqlash xati, jurnal yozildi", async () => {
      const r = await request(ilova()).post("/v1/auth/royxat").set("X-Forwarded-For", "203.0.113.7")
        .send({ email: "  Aziz@Example.COM ", toliqIsm: " Aziz Karimov ", parol: PAROL }).expect(202);
      assert.deepEqual(r.body, { xabar: "Agar bu email to'g'ri bo'lsa, unga xat yuborildi. Pochtangizni tekshiring." });
      assert.equal(r.headers["set-cookie"], undefined);
      await deps.fon.tugashi();
      const xat = deps.pochtachi.yuborilgan.at(-1);
      assert.ok(xat);
      assert.equal(xat.kimga, "aziz@example.com");
      assert.match(xat.matn, /http:\/\/localhost:5173\/tasdiqlash#token=[A-Za-z0-9_-]{43}/);
      assert.equal(r.headers["cache-control"], "no-store");
      const { rows } = await pool.query<{ parol_hash: string }>("SELECT parol_hash FROM foydalanuvchilar");
      assert.match(rows[0]?.parol_hash ?? "", /^\$argon2id\$/);
      assert.deepEqual(await hodisalar(), [{ tur: "royxat", foydalanuvchi_id: 1, sabab: null, ip: "203.0.113.7" }]);
      assert.equal((await pool.query("SELECT 1 FROM foydalanuvchilar WHERE email_tasdiqlangan_vaqt IS NULL")).rowCount, 1);
    });

    test("parol siyosati: qisqa, keng tarqalgan, ismni o'z ichiga olgan — 422, maydon bilan", async () => {
      const app = ilova();
      for (const [parol, kutilgan] of [["qisqa-parol", /kamida 15/], ["qwertyuiopasdfgh", /keng tarqalgan/], ["aziz-karimov-2026!", /ismingiz/]] as const) {
        const r = await request(app).post("/v1/auth/royxat").send({ email: "aziz@example.com", toliqIsm: "Aziz Karimov", parol }).expect(422);
        const x = r.body as { xatolar: { joy: string; xabar: string }[] };
        const birinchi = x.xatolar[0];
        assert.ok(birinchi);
        assert.equal(birinchi.joy, "body.parol");
        assert.match(birinchi.xabar, kutilgan);
      }
      assert.equal((await pool.query("SELECT 1 FROM foydalanuvchilar")).rowCount, 0);
    });

    test("mass assignment: ortiqcha maydon (rol, id) — 422, jim tashlanmaydi", async () => {
      const r = await request(ilova()).post("/v1/auth/royxat").send({ email: "a@example.com", toliqIsm: "A", parol: PAROL, rol: "admin", id: 99 }).expect(422);
      assert.match(JSON.stringify(r.body), /rol|id/);
    });

    test("email band (registrga befarq) — #12: AYNAN o'sha 202 javobi; egasiga ogohlantirish xati, hisob o'zgarmaydi (holat 05 da 409 edi)", async () => {
      const app = ilova();
      const a = await request(app).post("/v1/auth/royxat").send({ email: "aziz@example.com", toliqIsm: "Aziz", parol: PAROL }).expect(202);
      const b = await request(app).post("/v1/auth/royxat").send({ email: "AZIZ@example.com", toliqIsm: "Boshqa", parol: "Ikkinchi-uzun-parol-2026" }).expect(202);
      assert.deepEqual(a.body, b.body);
      await deps.fon.tugashi();
      assert.match(deps.pochtachi.yuborilgan.at(-1)?.mavzu ?? "", /ro'yxatdan o'tishga urinish/);
      const { rows } = await pool.query<{ ism: string }>("SELECT toliq_ism AS ism FROM foydalanuvchilar");
      assert.deepEqual(rows, [{ ism: "Aziz" }]);
      assert.deepEqual((await hodisalar()).map((h) => h.tur), ["royxat", "royxat_band"]);
    });
  });

  describe("POST /v1/auth/kirish", () => {
    beforeEach(async () => {
      await tozala(pool);
      await request(ilova()).post("/v1/auth/royxat").send({ email: "aziz@example.com", toliqIsm: "Aziz Karimov", parol: PAROL }).expect(202);
      await pool.query("UPDATE foydalanuvchilar SET email_tasdiqlangan_vaqt = now()"); // tasdiqlash oqimi — email.test.ts
      await pool.query("INSERT INTO foydalanuvchilar (email, toliq_ism) VALUES ('shahnoza@example.com', 'Shahnoza')"); // parolsiz hisob
      await pool.query("TRUNCATE auth_hodisalar");
    });

    test("200 — to'g'ri parol (email registri va bo'shliq farqsiz)", async () => {
      const r = await request(ilova()).post("/v1/auth/kirish").send({ email: " AZIZ@example.com", parol: PAROL }).expect(200);
      assert.deepEqual(r.body, { foydalanuvchi: { id: 1, email: "aziz@example.com", toliqIsm: "Aziz Karimov" } });
      assert.deepEqual((await hodisalar()).map((h) => h.tur), ["kirish"]);
    });

    test("enumeration yo'q: noto'g'ri parol, noma'lum email, parolsiz hisob — bir xil 401 tanasi; jurnalda sabab alohida", async () => {
      const app = ilova();
      const tanalar = [];
      for (const body of [{ email: "aziz@example.com", parol: "noto'g'ri-parol-123" }, { email: "yoq@example.com", parol: PAROL }, { email: "shahnoza@example.com", parol: PAROL }]) {
        const r = await request(app).post("/v1/auth/kirish").send(body).expect(401);
        const tana = { ...(r.body as Record<string, unknown>) };
        delete tana["sorovId"]; // har so'rovda boshqa
        tanalar.push(JSON.stringify(tana));
      }
      assert.equal(new Set(tanalar).size, 1, tanalar.join("\n"));
      assert.deepEqual((await hodisalar()).map((h) => [h.tur, h.foydalanuvchi_id, h.sabab]), [
        ["kirish_xato", 1, "parol"], ["kirish_xato", null, "email-yoq"], ["kirish_xato", 2, "parolsiz-hisob"],
      ]);
    });

    // t05 saboq'i: ikki email NAVBATMA-NAVBAT o'lchanadi (ketma-ket o'lchashda mashina yuklamasi birinchisiga tushib, kanonda ham 23 ms "farq" chiqqan)
    test("timing: noma'lum email ham argon2 bajaradi — mediana farqi kichik (≤ 20 ms yoki ≤ 15 %)", async () => {
      const app = ilova();
      const t: [number[], number[]] = [[], []];
      for (let i = 0; i < 9; i++) {
        for (const [j, email] of ["aziz@example.com", "hech-kim@example.com"].entries()) {
          const b = performance.now();
          await request(app).post("/v1/auth/kirish").send({ email, parol: "noto'g'ri-parol-123" }).expect(401);
          t[j]?.push(performance.now() - b);
        }
      }
      const [bor, yoq] = t.map((x) => x.sort((p, q) => p - q)[4] ?? 0);
      assert.ok(bor !== undefined && yoq !== undefined);
      // 31 #34 (flaky): yuklangan mashinada har kirish ~500 ms (yolg'iz ~50 ms) — shovqin ham shunga yarasha; mutlaq 20 ms chegara yiqildi (479 vs 506 ms).
      // Nisbiy chegara: vaqt orqali oshkor bo'lish (argon2 yo'q bo'lsa yo'q ~2 ms, bor ~50+ ms) baribir ushlanadi
      assert.ok(Math.abs(bor - yoq) < Math.max(20, 0.15 * Math.max(bor, yoq)), `bor ${bor.toFixed(1)} ms, yo'q ${yoq.toFixed(1)} ms`);
      assert.ok(yoq > 15, `noma'lum email ham hash qilinishi kerak (${yoq.toFixed(1)} ms)`);
    });

    test("rehash on login: eski parametrli hash — kirishda yangisiga almashadi", async () => {
      await pool.query("UPDATE foydalanuvchilar SET parol_hash = $1 WHERE id = 1", [await parolHash(PAROL, { m: 4096, t: 1, p: 1 })]);
      await request(ilova()).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL }).expect(200);
      const { rows } = await pool.query<{ h: string }>("SELECT parol_hash AS h FROM foydalanuvchilar WHERE id = 1");
      assert.match(rows[0]?.h ?? "", /m=19456,t=2,p=1/);
      assert.deepEqual((await hodisalar()).map((h) => h.tur), ["parol_qayta_hash", "kirish"]);
    });

    test("chegaralar: 1 MB parol — 413 (tana chegarasi), 600 belgi — 422 (hash qilinmaydi), noto'g'ri tur — 422, Content-Type — 415", async () => {
      const app = ilova();
      await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: "x".repeat(1_000_000) }).expect(413);
      await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: "x".repeat(600) }).expect(422);
      await request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: { $ne: null } }).expect(422);
      await request(app).post("/v1/auth/kirish").set("Content-Type", "text/plain").send(`email=aziz@example.com&parol=${PAROL}`).expect(415);
      await request(app).get("/v1/auth/kirish").expect(405).expect("Allow", "POST");
    });
  });
}
