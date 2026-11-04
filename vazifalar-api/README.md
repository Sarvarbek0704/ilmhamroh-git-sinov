# vazifalar-api

`vazifalar` ilovasining backend'i: vazifalar, hisob va xavfsizlik, integratsiyalar va AI yordamchi — bitta REST API.
NestJS 12 (Express 5), TypeScript, PostgreSQL 18 + pgvector, ixtiyoriy Redis.

## Imkoniyatlar

- **Vazifalar:** CRUD, filtr va saralash, kursorli sahifalash, ETag, Idempotency-Key, teglar, eksport (CSV/JSON).
- **Hisob:** sessiya (cookie), argon2id, email tasdiqlash, OTP, TOTP va passkey (2FA), OIDC, rollar va RLS, API kalitlar.
- **Integratsiyalar:** fayllar (S3), email, push, Telegram bot, webhook'lar, SSE, navbat (BullMQ + outbox).
- **AI (ixtiyoriy):** vazifani qadamlarga bo'lish, semantik qidiruv, yordamchi (RAG), MCP server; kunlik kvota, kesh, retry, circuit breaker, deadline.
- **Prodakshn:** audit jurnali, feature flag'lar, `/health/*`, `/metrics` (Prometheus), graceful shutdown.

## Tez boshlash

Kerak: Node.js 24, Docker.

```bash
git clone <repo-manzili> && cd vazifalar-api
npm ci                                   # postinstall: prisma generate
docker run -d --name vazifalar-pg -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:5432:5432 pgvector/pgvector:pg18
docker run -d --name vazifalar-redis -p 127.0.0.1:6379:6379 redis:8
cp .env.example .env                     # SAQLASH=postgres, DATABASE_URL=postgres://postgres@127.0.0.1:5432/vazifalar, REDIS_URL=…
npm run db:migrate && npm run db:seed
npm run start:dev                        # http://127.0.0.1:3000/docs — Swagger UI
```

`trust` — faqat lokal, faqat `127.0.0.1` uchun. Prodakshn sozlamalari — [docs/qanday/prodakshn-va-ai.md](docs/qanday/prodakshn-va-ai.md).

## Buyruqlar

| Buyruq | Nima |
|---|---|
| `npm run check` | tip + lint + test + build — PR'dan oldin shart |
| `npm test` | testlar (Vitest; Postgres/Redis bo'lmasa tegishli testlar SKIP) |
| `npm run start:dev` | ishlab chiqish serveri (`nest start --watch`) |
| `npm run build && npm start` | prodakshn: `dist/main.js` |
| `npm run db:migrate` / `db:seed` | migratsiyalar / demo ma'lumot |
| `npm run ishchi` · `bot` · `mcp` | fon ishchisi · Telegram bot · MCP server (alohida jarayonlar) |
| `npm run buyruq -- teglar \| eksport [csv\|json]` | HTTP'siz buyruq |

## Hujjatlar

| Turi ([Diátaxis](https://diataxis.fr/)) | Hujjat |
|---|---|
| O'rganish (tutorial) | yuqoridagi "Tez boshlash"; [docs/ARXITEKTURA.md](docs/ARXITEKTURA.md) §5–6 — lokal ishga tushirish va birinchi vazifa |
| Qanday qilish (how-to) | [docs/qanday/postgres-prisma-redis.md](docs/qanday/postgres-prisma-redis.md), [docs/qanday/prodakshn-va-ai.md](docs/qanday/prodakshn-va-ai.md) |
| Ma'lumotnoma (reference) | [API.md](API.md), `/docs` (OpenAPI), [TESTLAR.md](TESTLAR.md), [.env.example](.env.example), [CHANGELOG.md](CHANGELOG.md) |
| Tushuntirish (explanation) | [docs/ARXITEKTURA.md](docs/ARXITEKTURA.md), [docs/XAVFSIZLIK.md](docs/XAVFSIZLIK.md), [docs/AUTH-QAROR.md](docs/AUTH-QAROR.md), [docs/MAXFIYLIK.md](docs/MAXFIYLIK.md) |

## Hissa qo'shish

[CONTRIBUTING.md](CONTRIBUTING.md) — branch, commit, PR va review qoidalari. Xavfsizlik zaifligi — [SECURITY.md](SECURITY.md) (ochiq issue emas).

## Litsenziya

MIT — [LICENSE](LICENSE).
