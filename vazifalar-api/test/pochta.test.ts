// pochta.test.ts — 29-qism B (holat 13): 28 oqimlari (ro'yxat → tasdiqlash xati, parol tiklash) SMTP orqali — Mailpit; one-click obunadan chiqish.
// Mailpit (SMTP_HOST/SMTP_PORT, MAILPIT_API — muhit.sh) va auth test bazasi kerak; bo'lmasa SKIP.
import { afterAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { expressIlova } from "../test/yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { Pochta } from "../src/email/pochta.ts";
import { SmtpPochtachi, matndanHtml } from "../src/email/smtp-pochtachi.ts";
import { obunaTokeni, obunaTokeniniOch } from "../src/email/obuna.ts";
import { authBaza, authBogliqliklari, cookieniOl, PAROL, tozala } from "./auth-yordam.ts";

test("matndanHtml: ism ichidagi HTML ekranlanadi", () => {
  assert.equal(matndanHtml(`Salom, <b>"A&B"</b>\n2-qator`).includes(`Salom, &lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;<br>\n2-qator`), true);
});

test("obuna tokeni: to'g'ri — ochiladi; boshqa id / kanal / kalit / buzilgan imzo — yo'q", () => {
  const k = randomBytes(32);
  const t = obunaTokeni(k, 42, "email");
  assert.deepEqual(obunaTokeniniOch(k, t), { fId: 42, kanal: "email" });
  assert.equal(obunaTokeniniOch(k, t.replace(/^42\./, "43.")), undefined);
  assert.equal(obunaTokeniniOch(k, t.replace(".email.", ".sms.")), undefined);
  assert.equal(obunaTokeniniOch(randomBytes(32), t), undefined);
  assert.equal(obunaTokeniniOch(k, `${t.slice(0, -1)}${t.endsWith("A") ? "B" : "A"}`), undefined);
  assert.equal(obunaTokeniniOch(k, "0.email.x"), undefined);
});

const API = process.env["MAILPIT_API"];
const SMTP_PORT = process.env["SMTP_PORT"];
const baza = await authBaza("pochta");
if (typeof baza === "string" || API === undefined || SMTP_PORT === undefined) {
  test.skip(`SMTP (Mailpit) orqali 28 oqimlari — ${typeof baza === "string" ? baza : "MAILPIT_API/SMTP_PORT yo'q"}`, () => {});
} else {
  const pool = baza;
  const pochta = new Pochta({ host: process.env["SMTP_HOST"] ?? "127.0.0.1", port: Number(SMTP_PORT), secure: false, from: "Vazifalar <noreply@vazifalar.example.uz>" });
  afterAll(async () => { pochta.yop(); await pool.end(); });
  beforeEach(() => tozala(pool));
  const obunaKaliti = randomBytes(32);
  const ilova = async () => {
    const d = { ...authBogliqliklari(pool), pochtachi: new SmtpPochtachi(pochta) };
    return { d, app: await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, obunaKaliti }) };
  };
  type Xabar = { ID: string; Subject: string; HTML: string; Text: string };
  const xat = async (kimga: string, mavzu: RegExp): Promise<Xabar> => {
    for (let i = 0; i < 40; i++) {
      const r = (await (await fetch(`${API}/api/v1/search?query=${encodeURIComponent(`to:${kimga}`)}`)).json()) as { messages: { ID: string; Subject: string }[] };
      const m = r.messages.find((x) => mavzu.test(x.Subject));
      if (m) return (await (await fetch(`${API}/api/v1/message/${m.ID}`)).json()) as Xabar;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    throw new Error(`xat kelmadi: ${kimga} ${String(mavzu)}`);
  };
  const tokenOl = (x: Xabar) => /#token=([A-Za-z0-9_-]{43})/.exec(x.Text)?.[1] ?? assert.fail("xatda token yo'q");

  test("ro'yxat → Mailpit'dagi tasdiqlash xati (HTML shablon, 24 soat) → email-tasdiq → sessiya; parol tiklash xati → yangi parol", async () => {
    const { d, app } = await ilova();
    const email = `aziz-${randomUUID().slice(0, 8)}@example.uz`;
    await request(app).post("/v1/auth/royxat").send({ email, toliqIsm: `Aziz <script>`, parol: PAROL }).expect(202);
    await d.fon.tugashi();
    const t = await xat(email, /Emailingizni tasdiqlang/);
    assert.match(t.HTML, /Salom, Aziz &lt;script&gt;!/);
    assert.match(t.HTML, /Havola 24 soat amal qiladi/);
    assert.match(t.Text, /http:\/\/localhost:5173\/tasdiqlash#token=/);
    const r = await request(app).post("/v1/auth/email-tasdiq").send({ token: tokenOl(t) }).expect(200);
    cookieniOl(r.headers["set-cookie"]);

    await request(app).post("/v1/auth/parol-tiklash/sorov").send({ email }).expect(202);
    await d.fon.tugashi();
    const p = await xat(email, /Parolni tiklash/);
    assert.match(p.HTML, /Parol o&#x27;rnatish|Parol o'rnatish/);
    assert.match(p.Text, /30 daqiqa, bir marta/);
    await request(app).post("/v1/auth/parol-tiklash").send({ token: tokenOl(p), parol: "Yangi-bahor-choyxona-2027" }).expect(204);
  });

  test("one-click obunadan chiqish: GET o'zgartirmaydi; POST (cookie'siz, RFC 8058 tanasi) → sozlamalar.bildirishnoma.email = false; yolg'on token — 404", async () => {
    const { d, app } = await ilova();
    const email = `dil-${randomUUID().slice(0, 8)}@example.uz`;
    await request(app).post("/v1/auth/royxat").send({ email, toliqIsm: "Dilnoza", parol: PAROL }).expect(202);
    await d.fon.tugashi();
    const fId = Number((await pool.query<{ id: string }>("SELECT id FROM foydalanuvchilar WHERE email = $1", [email])).rows[0]?.id);
    await pool.query("UPDATE foydalanuvchilar SET sozlamalar = '{\"til\":\"uz-Latn\",\"bildirishnoma\":{\"telegram\":true}}' WHERE id = $1", [fId]);
    const token = obunaTokeni(obunaKaliti, fId, "email");
    const sozlama = async () => (await pool.query<{ s: unknown }>("SELECT sozlamalar AS s FROM foydalanuvchilar WHERE id = $1", [fId])).rows[0]?.s;
    const g = await request(app).get(`/v1/obuna/${token}`).expect(200);
    assert.match(g.text, /<form method="post">/);
    assert.deepEqual(await sozlama(), { til: "uz-Latn", bildirishnoma: { telegram: true } });
    await request(app).post(`/v1/obuna/${token}`).type("form").send("List-Unsubscribe=One-Click").expect(200);
    assert.deepEqual(await sozlama(), { til: "uz-Latn", bildirishnoma: { telegram: true, email: false } });
    await request(app).post(`/v1/obuna/${token}`).type("form").send("List-Unsubscribe=One-Click").expect(200); // takror — idempotent
    await request(app).post(`/v1/obuna/${obunaTokeni(randomBytes(32), fId, "email")}`).type("form").send("List-Unsubscribe=One-Click").expect(404);
    await request(app).post(`/v1/obuna/${obunaTokeni(obunaKaliti, fId + 999, "email")}`).type("form").send("List-Unsubscribe=One-Click").expect(404);
  });
}
