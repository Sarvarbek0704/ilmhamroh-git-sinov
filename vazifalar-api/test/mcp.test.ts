// mcp.test.ts — 31-qism #20 (B-211): MCP server REST API mijozi sifatida — haqiqiy HTTP (lokal server) + API kalit, MCP Client bilan (InMemoryTransport).
// Vositalar ro'yxati va annotatsiyalari, vazifa qo'shish/ro'yxat/bajarildi, resurs vazifa://{id}, AI qadamlar (soxta provayder), faqat o'qish kaliti — yozish isError (403),
// noto'g'ri argument — protokol darajasida rad (handler chaqirilmaydi). Auth bazasi kerak; bo'lmasa SKIP.
import { afterAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expressIlova } from "./yordamchi.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { SoxtaProvayder } from "../src/ai/soxta.ts";
import { apiMijoz, mcpServerYarat } from "../src/mcp/mcp-server.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";

type Matnli = { content: { type: string; text: string }[]; isError?: boolean };

const baza = await authBaza("mcp");
if (typeof baza === "string") {
  test.skip(`MCP server (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  afterAll(() => pool.end());
  beforeEach(() => tozala(pool));

  const tayyorla = async (ruxsatlar: string[]) => {
    const d = authBogliqliklari(pool);
    const p = new SoxtaProvayder({ javob: () => JSON.stringify({ qadamlar: [{ matn: "Ro'yxat tuzish", daqiqa: 10 }, { matn: "Do'konga borish", daqiqa: 30 }] }) });
    const app = await expressIlova({ ombor: (e) => new PgOmbori(pool, e), auth: d, ai: { pool, provayder: p } });
    const srv = createServer(app).listen(0, "127.0.0.1");
    await once(srv, "listening");
    const url = `http://127.0.0.1:${String((srv.address() as AddressInfo).port)}`;
    const aziz = await hisobOch(app, d, "aziz@example.com");
    const k = (await request(app).post("/v1/auth/api-kalitlar").set("Cookie", aziz).send({ nom: "mcp", ruxsatlar }).expect(201)).body as Record<string, unknown>;
    const kalit = Object.values(k).find((v): v is string => typeof v === "string" && v.startsWith("vz_")) ?? assert.fail("kalit yo'q");
    const server = mcpServerYarat(apiMijoz(url, kalit));
    const mijoz = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([mijoz.connect(a), server.connect(b)]);
    return { mijoz, aziz, app, yop: async () => { await mijoz.close(); await server.close(); srv.close(); } };
  };

  test("vositalar: ro'yxat + annotatsiyalar; qo'shish → ro'yxat → bajarildi → resurs; AI qadamlar", async () => {
    const { mijoz, yop } = await tayyorla(["vazifalar:oqish", "vazifalar:yozish"]);
    try {
      const { tools } = await mijoz.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), ["vazifa_bajarildi", "vazifa_qosh", "vazifalar_royxati", "vazifani_qadamlarga_bol"]);
      assert.equal(tools.find((t) => t.name === "vazifalar_royxati")?.annotations?.readOnlyHint, true);
      // 32 #01 (31 nuqsoni): AI vositasi kvota sarflaydi va hodisa yozadi — "faqat o'qish" EMAS
      assert.deepEqual(tools.find((t) => t.name === "vazifani_qadamlarga_bol")?.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
      assert.equal((tools.find((t) => t.name === "vazifa_qosh")?.inputSchema.properties as Record<string, { maxLength?: number }>)["matn"]?.maxLength, 100);

      const q = await mijoz.callTool({ name: "vazifa_qosh", arguments: { matn: "Non olish #uy" } }) as Matnli;
      const v = JSON.parse(q.content[0]?.text ?? "{}") as { id: number; teglar: string[] };
      assert.deepEqual(v.teglar, ["uy"]);
      const r = await mijoz.callTool({ name: "vazifalar_royxati", arguments: { teg: "uy" } }) as Matnli;
      assert.match(r.content[0]?.text ?? "", /Non olish/);
      const b = await mijoz.callTool({ name: "vazifa_bajarildi", arguments: { id: v.id } }) as Matnli;
      assert.equal((JSON.parse(b.content[0]?.text ?? "{}") as { bajarildi: boolean }).bajarildi, true);
      const res = await mijoz.readResource({ uri: `vazifa://${String(v.id)}` });
      const c0 = res.contents[0];
      assert.match(c0 !== undefined && "text" in c0 ? c0.text : "", /"bajarildi":true/);
      const ai = await mijoz.callTool({ name: "vazifani_qadamlarga_bol", arguments: { id: v.id } }) as Matnli;
      assert.match(ai.content[0]?.text ?? "", /Do'konga borish/);
      const yoq = await mijoz.callTool({ name: "vazifa_bajarildi", arguments: { id: 999_999 } }) as Matnli;
      assert.equal(yoq.isError, true);
      assert.match(yoq.content[0]?.text ?? "", /^HTTP 404/);
      const notogri = await mijoz.callTool({ name: "vazifa_qosh", arguments: { matn: "x".repeat(101) } }) as Matnli;
      assert.equal(notogri.isError, true); // SDK sxema tekshiruvi — API'ga bormaydi
      assert.match(notogri.content[0]?.text ?? "", /validation|101|100/i);
    } finally {
      await yop();
    }
  });

  test("faqat o'qish kaliti: ro'yxat ishlaydi, qo'shish — isError HTTP 403 (agent kalit ruxsatidan oshmaydi)", async () => {
    const { mijoz, yop } = await tayyorla(["vazifalar:oqish"]);
    try {
      assert.equal(((await mijoz.callTool({ name: "vazifalar_royxati", arguments: {} })) as Matnli).isError, undefined);
      const x = await mijoz.callTool({ name: "vazifa_qosh", arguments: { matn: "Ruxsatsiz" } }) as Matnli;
      assert.equal(x.isError, true);
      assert.match(x.content[0]?.text ?? "", /^HTTP 403/);
    } finally {
      await yop();
    }
  });
}
