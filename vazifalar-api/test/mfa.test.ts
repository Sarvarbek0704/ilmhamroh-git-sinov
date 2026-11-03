// mfa.test.ts — #19 (holat 19): 2FA oqimi API orqali — sozlash, yoqish (zaxira kodlar), parol bilan kirish → mfa kerak → TOTP / zaxira kod → sessiya,
// qayta ishlatish, o'chirish; siri bazada ochiq emas. Passkey — e2e/passkey.e2e.ts (haqiqiy brauzer, virtual autentifikator).
import { afterAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { hotp, qadam } from "../src/auth/totp.ts";
import { authBaza, authBogliqliklari, cookieniOl, hisobOch, PAROL, tozala } from "./auth-yordam.ts";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32dan = (s: string): Buffer => {
  let bits = 0, q = 0;
  const b: number[] = [];
  for (const ch of s) {
    q = (q << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { b.push((q >>> (bits - 8)) & 255); bits -= 8; q &= (1 << bits) - 1; }
  }
  return Buffer.from(b);
};

const baza = await authBaza("mfa");
if (typeof baza === "string") {
  test.skip(`MFA (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  const d = authBogliqliklari(pool);
  const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d });
  beforeEach(() => tozala(pool));
  const kir = () => request(app).post("/v1/auth/kirish").send({ email: "aziz@example.com", parol: PAROL });

  /** Aziz 2FA yoqadi → {siri, zaxira kodlar, sessiya cookie} */
  async function yoq(): Promise<{ siri: Buffer; zaxira: string[]; c: string }> {
    const c = await hisobOch(app, d, "aziz@example.com");
    const s = await request(app).post("/v1/auth/2fa/sozlash").set("Cookie", c).expect(200);
    const siri = b32dan((s.body as { siri: string }).siri);
    assert.match((s.body as { otpauth: string }).otpauth, /^otpauth:\/\/totp\//);
    await request(app).post("/v1/auth/2fa/yoqish").set("Cookie", c).send({ kod: "000000" === hotp(siri, qadam()) ? "111111" : "000000" }).expect(401);
    const y = await request(app).post("/v1/auth/2fa/yoqish").set("Cookie", c).send({ kod: hotp(siri, qadam()) }).expect(200);
    return { siri, zaxira: (y.body as { zaxiraKodlar: string[] }).zaxiraKodlar, c };
  }

  test("yoqish: 10 zaxira kod; siri va kodlar bazada ochiq emas; qayta sozlash — 409", async () => {
    const { siri, zaxira, c } = await yoq();
    assert.equal(zaxira.length, 10);
    assert.ok(zaxira.every((k) => /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(k)));
    const t = (await pool.query<{ t: string }>("SELECT (SELECT string_agg(m::text, '') FROM mfa_totp m) || (SELECT string_agg(z::text, '') FROM zaxira_kodlar z) AS t")).rows[0]?.t ?? "";
    assert.ok(!t.includes(siri.toString("hex")) && !zaxira.some((k) => t.includes(Buffer.from(k).toString("hex"))));
    await request(app).post("/v1/auth/2fa/sozlash").set("Cookie", c).expect(409);
  });

  test("parol bilan kirish → {mfa: 'kerak'}, sessiya YO'Q; TOTP bilan → sessiya; o'sha kod qayta — 401", async () => {
    const { siri } = await yoq();
    await pool.query("UPDATE mfa_totp SET oxirgi_qadam = 0"); // yoqishda ishlatilgan kod qadami — testda boshqa kod kerak bo'lmasin
    const r = await kir().expect(200);
    assert.deepEqual(r.body, { mfa: "kerak" });
    const cookies = r.headers["set-cookie"] as unknown as string[];
    assert.ok(!cookies.some((x) => x.startsWith("__Host-sessiya=")));
    const mfa = cookieniOl(cookies, "__Host-mfa");
    await request(app).get("/v1/vazifalar").set("Cookie", mfa).expect(401);
    const kod = hotp(siri, qadam());
    const ok = await request(app).post("/v1/auth/2fa/tekshir").set("Cookie", mfa).send({ kod }).expect(200);
    await request(app).get("/v1/vazifalar").set("Cookie", cookieniOl(ok.headers["set-cookie"])).expect(200);
    const r2 = await kir().expect(200);
    await request(app).post("/v1/auth/2fa/tekshir").set("Cookie", cookieniOl(r2.headers["set-cookie"], "__Host-mfa")).send({ kod }).expect(401);
  });

  test("zaxira kod — bir marta; mfa cookie'siz yoki buzilgan — 401 mfa-kutilmagan; noto'g'ri kod — jurnalga", async () => {
    const { zaxira } = await yoq();
    const mfa = async () => cookieniOl((await kir().expect(200)).headers["set-cookie"], "__Host-mfa");
    const k = zaxira[0] ?? "";
    await request(app).post("/v1/auth/2fa/tekshir").set("Cookie", await mfa()).send({ zaxiraKod: k.toLowerCase() }).expect(200); // registr va "-" farqsiz
    await request(app).post("/v1/auth/2fa/tekshir").set("Cookie", await mfa()).send({ zaxiraKod: k }).expect(401);
    const x = await request(app).post("/v1/auth/2fa/tekshir").send({ kod: "123456" }).expect(401);
    assert.equal((x.body as { kod: string }).kod, "mfa-kutilmagan");
    const m = await mfa();
    await request(app).post("/v1/auth/2fa/tekshir").set("Cookie", `${m.slice(0, -4)}AAAA`).send({ kod: "123456" }).expect(401);
    await request(app).post("/v1/auth/2fa/tekshir").set("Cookie", m).send({ kod: "000000" }).expect(401);
    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM auth_hodisalar WHERE tafsilot->>'sabab' = 'mfa'");
    assert.ok((rows[0]?.n ?? 0) >= 2);
  });

  test("o'chirish — joriy kod yoki zaxira kod bilan; keyin parol bilan to'g'ridan sessiya", async () => {
    const { zaxira, c } = await yoq();
    await request(app).post("/v1/auth/2fa/ochirish").set("Cookie", c).send({ kod: "000000" }).expect(401);
    await request(app).post("/v1/auth/2fa/ochirish").set("Cookie", c).send({ kod: zaxira[1] }).expect(204);
    const r = await kir().expect(200);
    assert.ok(cookieniOl(r.headers["set-cookie"]));
  });
}
