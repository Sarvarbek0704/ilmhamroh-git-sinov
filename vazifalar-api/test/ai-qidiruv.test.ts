// ai-qidiruv.test.ts — 31-qism #16 zaxira model, #17 semantik/gibrid qidiruv (pgvector), #18 RAG. Soxta provayder: embedding — so'zlar sumkasi xeshi
// (ma'no emas, lekin bir xil so'zli matnlar yaqin) — tarmoqqa chiqmaydi. Auth test bazasi (303: pgvector) kerak; bo'lmasa SKIP.
import { afterAll, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { expressIlova } from "./yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { SoxtaProvayder } from "../src/ai/soxta.ts";
import { LlmXatosi } from "../src/ai/llm.ts";
import type { LlmSorov } from "../src/ai/llm.ts";
import { ZaxiraliProvayder } from "../src/ai/zaxira.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";

describe("#16 zaxira model", () => {
  test("vaqtinchalik xato (429) — bir marta zaxira model bilan; doimiy xato (sxema) — o'tmaydi; oqim — faqat birinchi bo'lakdan oldin", async () => {
    const p = new SoxtaProvayder({ javob: () => "{}", xatolar: [new LlmXatosi("limit", "429", undefined, 429)] });
    const z = new ZaxiraliProvayder(p, "zaxira-model");
    const s: LlmSorov = { tizim: "t", xabarlar: [{ rol: "user", matn: "x" }] };
    assert.equal((await z.yarat(s)).model, "zaxira-model");
    assert.deepEqual(p.chaqiruvlar.map((c) => c.model), [undefined, "zaxira-model"]);
    assert.equal(z.otishlar, 1);
    p.s.xatolar = [new LlmXatosi("notogri", "sxema")];
    await assert.rejects(z.yarat(s), /sxema/);
    assert.equal(z.otishlar, 1);
    p.s.xatolar = [new LlmXatosi("band", "503", undefined, 503)];
    const bolaklar: string[] = [];
    for await (const b of z.oqim(s)) if (b.tur === "tugadi") bolaklar.push(b.javob.model);
    assert.deepEqual(bolaklar, ["zaxira-model"]);
  });
});

const baza = await authBaza("ai_qidiruv");
if (typeof baza === "string") {
  test.skip(`AI qidiruv va RAG (Postgres + pgvector) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  beforeEach(() => tozala(pool));
  const VAZIFALAR = ["Non va sut sotib olish", "Hisobot yozish #ish", "IELTS imtihoniga tayyorlanish", "Bozorga borib meva olish", "Sut mahsulotlari narxini solishtirish"];
  const ilova = async (p: SoxtaProvayder) => {
    const d = authBogliqliklari(pool);
    const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, ai: { pool, provayder: p, embeddingModel: "soxta-emb" } });
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const dil = await hisobOch(app, d, "dilnoza@example.com");
    const idlar: number[] = [];
    for (const m of VAZIFALAR) idlar.push(((await request(app).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: m }).expect(201)).body as { id: number }).id);
    await request(app).post("/v1/vazifalar").set("Cookie", dil).send({ matn: "Sut va qatiq olish (Dilnoza)" }).expect(201);
    return { app, aziz, dil, idlar };
  };
  type Javob = { rejim: string; vazifalar: { id: number; matn: string; ball: number }[] };

  test("#17 semantik: embedding'lar dangasa (bir paketda), takror so'rovda qayta hisoblanmaydi, matn o'zgarsa — faqat o'sha; begona vazifalar yo'q", async () => {
    const p = new SoxtaProvayder();
    const { app, aziz, idlar } = await ilova(p);
    const r = (await request(app).get("/v1/qidiruv?q=sut olish&rejim=semantik&limit=3").set("Cookie", aziz).expect(200)).body as Javob;
    assert.equal(r.vazifalar[0]?.matn, "Non va sut sotib olish");
    assert.ok(r.vazifalar.every((v) => !v.matn.includes("Dilnoza")));
    assert.equal(p.embeddingChaqiruvlar, 2); // 5 vazifa — 1 paket + savol
    await request(app).get("/v1/qidiruv?q=hisobot&rejim=semantik").set("Cookie", aziz).expect(200);
    assert.equal(p.embeddingChaqiruvlar, 3); // faqat savol
    await request(app).patch(`/v1/vazifalar/${String(idlar[1])}`).set("Cookie", aziz).set("Content-Type", "application/merge-patch+json").send({ matn: "Choraklik hisobot yozish #ish" }).expect(200);
    await request(app).get("/v1/qidiruv?q=hisobot&rejim=semantik").set("Cookie", aziz).expect(200);
    assert.equal(p.embeddingChaqiruvlar, 5); // o'zgargan 1 ta vazifa + savol
    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM vazifa_embeddinglar");
    assert.equal(rows[0]?.n, 5); // Dilnozaniki hali so'ralmagan — hisoblanmagan
    await request(app).get("/v1/qidiruv?q=a").set("Cookie", aziz).expect(400);
    await request(app).get("/v1/qidiruv?q=sut").expect(401);
  });

  test("#17 gibrid: FTS (so'z) + vektor → RRF; o'chirilgan vazifa chiqmaydi", async () => {
    const { app, aziz, idlar } = await ilova(new SoxtaProvayder());
    await request(app).delete(`/v1/vazifalar/${String(idlar[0])}`).set("Cookie", aziz).expect(204);
    const r = (await request(app).get("/v1/qidiruv?q=sut").set("Cookie", aziz).expect(200)).body as Javob;
    assert.equal(r.rejim, "gibrid");
    assert.equal(r.vazifalar[0]?.matn, "Sut mahsulotlari narxini solishtirish");
    assert.ok(!r.vazifalar.some((v) => v.id === idlar[0]));
  });

  test("#18 RAG: kontekstda faqat o'z vazifalari; model ixtiro qilgan manba id'si olib tashlanadi; javob sxemaga mos emas — 502", async () => {
    let oxirgi: LlmSorov | undefined;
    const p = new SoxtaProvayder({ javob: (s) => { oxirgi = s; return JSON.stringify({ javob: "Sut olish vazifangiz bor.", manbalar: [idSut, 999_999] }); } });
    let idSut = 0;
    const { app, aziz, idlar } = await ilova(p);
    idSut = idlar[0] ?? 0;
    const r = (await request(app).post("/v1/yordamchi/savol").set("Cookie", aziz).send({ savol: "Sut bilan bog'liq nima ishim bor?" }).expect(200)).body as { javob: string; manbalar: { id: number }[] };
    assert.equal(r.javob, "Sut olish vazifangiz bor.");
    assert.deepEqual(r.manbalar.map((m) => m.id), [idSut]);
    assert.ok(oxirgi?.xabarlar[0]?.matn.includes(`id=${String(idSut)}`));
    assert.match(oxirgi?.xabarlar[0]?.matn ?? "", /^Bugun: \d{4}-\d{2}-\d{2} \((dushanba|seshanba|chorshanba|payshanba|juma|shanba|yakshanba)\)\n<vazifalar>/); // nisbiy vaqt savollari uchun
    assert.ok(!(oxirgi?.xabarlar[0]?.matn.includes("Dilnoza") ?? true));
    assert.equal((oxirgi?.jsonSxema as { type?: string } | undefined)?.type, "object");
    p.s.javob = () => "Albatta, mana javob";
    await request(app).post("/v1/yordamchi/savol").set("Cookie", aziz).send({ savol: "Nima qilay?" }).expect(502);
    await request(app).post("/v1/yordamchi/savol").set("Cookie", aziz).send({ savol: "?" }).expect(422);
  });
}
