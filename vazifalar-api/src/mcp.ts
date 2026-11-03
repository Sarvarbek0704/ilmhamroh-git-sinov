// mcp.ts — 31-qism #20 (B-211): MCP server (stdio). Claude Desktop / Claude Code / boshqa MCP mijoz uni jarayon sifatida ishga tushiradi:
//   { "command": "node", "args": ["dist/mcp.js"], "env": { "VAZIFALAR_API_URL": "https://…", "VAZIFALAR_API_KALITI": "vz_…" } }
// stdout — FAQAT MCP protokoli (JSON-RPC): bitta ortiqcha console.log protokolni buzadi → hamma xabar stderr'ga (30-qism ochiq xatosi: buyruq.ts logi stdout'da edi).
// Kalit — foydalanuvchi o'z hisobida yaratgan API kaliti (POST /v1/auth/api-kalitlar, ruxsatlar: vazifalar:oqish, vazifalar:yozish) — agent shundan ortiq qila olmaydi.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { apiMijoz, mcpServerYarat } from "./mcp/mcp-server.ts";

const url = (process.env["VAZIFALAR_API_URL"] ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const kalit = process.env["VAZIFALAR_API_KALITI"];
if (kalit === undefined || !/^vz_[A-Za-z0-9_-]{8,}$/.test(kalit)) {
  process.stderr.write("VAZIFALAR_API_KALITI kerak (vz_… — POST /v1/auth/api-kalitlar)\n");
  process.exit(78); // EX_CONFIG — 25-qism kelishuvi
}
const server = mcpServerYarat(apiMijoz(url, kalit));
await server.connect(new StdioServerTransport());
process.stderr.write(`vazifalar MCP server: ${url} (stdio)\n`);
