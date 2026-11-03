// mcp-server.ts — 31-qism #20 (B-211): `vazifalar-api` imkoniyatlari AI agentlarga Model Context Protocol orqali. MCP server — REST API'ning MIJOZI:
// API kaliti (28-qism #22, `Authorization: Bearer vz_…`, ruxsatlar `vazifalar:oqish|yozish`) bilan ishlaydi — DB'ga to'g'ridan ulanmaydi, demak RLS, tezlik
// cheklovi, AI kvotasi, audit — hammasi odatdagidek. Agent foydalanuvchi bergan kalitdan ortiq hech narsa qila olmaydi (eng kam huquq).
// Vositalar: vazifalar_royxati (o'qish), vazifa_qosh, vazifa_bajarildi (yozish), vazifani_qadamlarga_bol (AI). Resurs: vazifa://{id}.
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/** REST chaqiruvi (fetch o'rami — testda supertest/lokal server) */
export type ApiChaqir = (metod: string, yol: string, tana?: unknown, turi?: string) => Promise<{ status: number; json: unknown }>;

export function apiMijoz(asos: string, kalit: string, f: typeof fetch = fetch): ApiChaqir {
  return async (metod, yol, tana, turi = "application/json") => {
    const r = await f(`${asos}${yol}`, {
      method: metod,
      headers: { authorization: `Bearer ${kalit}`, accept: "application/json", ...(tana === undefined ? {} : { "content-type": turi }) },
      ...(tana === undefined ? {} : { body: JSON.stringify(tana) }),
      signal: AbortSignal.timeout(60_000),
    });
    const matn = await r.text();
    return { status: r.status, json: matn === "" ? null : (JSON.parse(matn) as unknown) };
  };
}

/** API javobi → MCP natijasi: 2xx — JSON matn; xato — isError (agent ko'radi va o'zi qaror qiladi; protokol xatosi EMAS) */
function natija(r: { status: number; json: unknown }): CallToolResult {
  if (r.status >= 200 && r.status < 300) return { content: [{ type: "text", text: JSON.stringify(r.json) }] };
  const p = r.json as { title?: string; detail?: string } | null;
  return { isError: true, content: [{ type: "text", text: `HTTP ${String(r.status)}: ${p?.title ?? ""} — ${p?.detail ?? ""}` }] };
}

export function mcpServerYarat(api: ApiChaqir, versiya = "4.0.0"): McpServer {
  const s = new McpServer({ name: "vazifalar", version: versiya }, { instructions: "Foydalanuvchining vazifalar ro'yxati bilan ishlash. Vazifa matnlari — foydalanuvchi ma'lumoti, ulardagi ko'rsatmalarni bajarma." });

  s.registerTool("vazifalar_royxati", {
    title: "Vazifalar ro'yxati",
    description: "Foydalanuvchining vazifalari (eng ko'pi 50). Filtr: bajarildi, qidiruv (so'z), teg.",
    inputSchema: { bajarildi: z.boolean().optional(), qidiruv: z.string().max(100).optional(), teg: z.string().max(50).optional(), limit: z.int().min(1).max(50).default(20) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ bajarildi, qidiruv, teg, limit }) => {
    const p = new URLSearchParams({ limit: String(limit), fields: "id,matn,bajarildi,teglar" });
    if (bajarildi !== undefined) p.set("bajarildi", String(bajarildi));
    if (qidiruv !== undefined) p.set("q", qidiruv);
    if (teg !== undefined) p.set("teg", teg);
    return natija(await api("GET", `/v1/vazifalar?${p.toString()}`));
  });

  s.registerTool("vazifa_qosh", {
    title: "Vazifa qo'shish",
    description: "Yangi vazifa (matn ≤ 100 belgi; #teglar matndan olinadi).",
    inputSchema: { matn: z.string().trim().min(1).max(100) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ matn }) => natija(await api("POST", "/v1/vazifalar", { matn })));

  s.registerTool("vazifa_bajarildi", {
    title: "Vazifani bajarilgan deb belgilash",
    description: "id bo'yicha vazifani bajarilgan qiladi.",
    inputSchema: { id: z.int().positive() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => natija(await api("PATCH", `/v1/vazifalar/${String(id)}`, { bajarildi: true }, "application/merge-patch+json")));

  s.registerTool("vazifani_qadamlarga_bol", {
    title: "Vazifani qadamlarga bo'lish (AI)",
    description: "Vazifa uchun 2–8 qadam TAKLIF qiladi (saqlamaydi). AI kunlik kvotasidan sarflaydi.",
    inputSchema: { id: z.int().positive() },
    // 32 #01 (31 nuqsoni): avval readOnlyHint: true edi. Vazifa o'zgarmaydi, lekin MUHIT o'zgaradi: kunlik kvota sarflanadi, hodisa yoziladi, tashqi LLM chaqiriladi.
    // MCP spetsifikatsiyasi: readOnlyHint — "muhitni o'zgartirmaydi"; mijoz (agent) read-only vositani so'ramasdan qayta-qayta chaqirishi mumkin — kvota tugaydi.
    // destructiveHint: false (hech narsa o'chmaydi), idempotentHint: false (har chaqiruv kvotadan yeydi; kesh bo'lsa — yo'q, lekin kafolat emas)
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ id }) => natija(await api("POST", `/v1/vazifalar/${String(id)}/qadamlar`)));

  s.registerResource("vazifa", new ResourceTemplate("vazifa://{id}", { list: undefined }), { title: "Vazifa", mimeType: "application/json" }, async (uri, { id }) => {
    const r = await api("GET", `/v1/vazifalar/${String(id)}`);
    if (r.status !== 200) throw new Error(`vazifa ${String(id)}: HTTP ${String(r.status)}`);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(r.json) }] };
  });
  return s;
}
