# Qanday: prodakshn sozlamalari va AI

> README'dan ko'chirildi (32-qism #12).

## Prodakshn va AI (31-qism, v4)
- **AI** (`AI_PROVAYDER=gemini`, `GEMINI_API_KEY` — faqat `.env`): vazifani qadamlarga bo'lish (`POST /v1/vazifalar/:id/qadamlar`, JSON yoki SSE), semantik qidiruv
  (`GET /v1/qidiruv`, pgvector), yordamchi (RAG, `POST /v1/yordamchi/savol`); kunlik kvota, kesh, retry/circuit breaker/bulkhead, zaxira model, feature flag'lar.
  Postgres image — `pgvector/pgvector:pg18` (`CREATE EXTENSION vector`). OpenAI-mos va Anthropic provayderlari — kodda bor, SINALMAGAN.
- **MCP server**: `npm run build && npm run mcp` (stdio; `VAZIFALAR_API_URL`, `VAZIFALAR_API_KALITI` — API kalit) — Claude Desktop / Claude Code'ga ulash mumkin.
- **Ma'lumotlar**: vazifa hodisalari (oyma-oy bo'limlar), saqlash muddati (ishchi har kuni 04:15), hisobni o'chirish (`DELETE /v1/auth/men`), audit jurnali (`audit` sxemasi).
  Qonun xaritasi — `docs/MAXFIYLIK.md`.
- **Kuzatuv**: `/health/live|ready|startup`, `/metrics` (Prometheus), `YOPISH_KECHIKISH_MS` (graceful drain).
