# vazifalar-api

`vazifalar` ilovasining backend'i — Node.js 24 + TypeScript + **NestJS 12** (Express 5 adapteri) REST API (v1, ilova versiyasi 4.0.0 — 31-qism: prodakshn va AI).
Saqlash: xotira, JSON fayl, PostgreSQL (pg yoki Prisma 7), ixtiyoriy Redis kesh. HTTP shartnomasi 25–27-qismdagi Express versiyasi bilan bir xil.

## Ishga tushirish

```bash
npm ci
cp .env.example .env      # kerak bo'lsa o'zgartiring
npm run start:dev         # nest start --watch
npm run build && npm start  # production: node --env-file-if-exists=.env dist/main.js
```

Endi **build bor** (`nest build` → `dist/`): Nest dekoratorlari va `emitDecoratorMetadata` Node type stripping'da ishlamaydi. Nisbiy importlar `.ts`
kengaytmali (`rewriteRelativeImportExtensions` — `dist/` da `.js`). SWC builder (`nest build --builder swc`) — bu sozlama bilan ISHLAMAYDI (`.ts` importlarni
qayta yozmaydi, `ERR_MODULE_NOT_FOUND`).

## Buyruqlar

| Buyruq | Nima |
|---|---|
| `npm test` | testlar (Vitest) |
| `npm run tip` | `tsc --noEmit` |
| `npm run lint` | ESLint (typescript-eslint strictTypeChecked) |
| `npm run check` | tip + lint + test |
| `npm run build` | `nest build` (tsc) → `dist/` |
| `npm run buyruq -- teglar \| eksport [csv\|json]` | HTTP'siz standalone buyruq (`createApplicationContext`) |
| `npm run sxema` | Zod sxemalaridan `docs/sxemalar.json` (JSON Schema) |

API qo'llanmasi — [API.md](API.md) va ishlab turgan serverda `/docs` (Swagger UI), `/docs-json`; testlar — [TESTLAR.md](TESTLAR.md).

## Tuzilma

```
src/main.ts              kirish: Nest ilovasi → server → jarayon hodisalari (SIGTERM, let it crash)
src/ilova.ts             ilovaYarat(): NestFactory + Express middleware'lari (tartib muhim) + versiyalash + OpenAPI
src/app.module.ts        ildiz modul: config, log (nestjs-pino), CLS, hodisalar, rejalashtirish, ombor, xususiyat modullari, global pipe/guard/filtr
src/bogliqliklar.module.ts  ConfigModule (registerAs + Zod configYukla), LOG, XABARCHI, IDEMPOTENTLIK_OMBORI
src/ombor.module.ts      VAZIFA_OMBORI — config bo'yicha (async fabrika), yopishda pool/redis
src/vazifalar/           controller'lar, VazifalarService (domen hodisalari), tinglovchi (webhook), omborlar, Zod sxemalari
src/eksport/             202 + polling; eskirgan ishlar @Interval bilan tozalanadi
src/salomatlik/          /health/live, /health/ready (@nestjs/terminus)
src/umumiy/              Problem Details filtri, SxemaPipe (Standard Schema), JsonTana guard, interceptor, dekoratorlar, idempotentlik, log
```

## PostgreSQL bilan (26-qism)
Sxema — kurs SQL fayllari (`sinov/26/sql/001…014`, keyin 27-qismda migratsiya vositasi). Lokal baza (Docker, faqat 127.0.0.1, parolsiz trust):

```bash
docker run -d --name vazifalar-pg -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:5499:5432 -v vazifalar-pg:/var/lib/postgresql postgres:18
# sxemani qo'llash: har .sql faylni tartib bilan, bitta tranzaksiyada — psql -1 -v ON_ERROR_STOP=1 -f <fayl>
SAQLASH=postgres DATABASE_URL=postgres://postgres@127.0.0.1:5499/vazifalar EGASI_ID=1 npm start   # (avval npm run build)
```

- `EGASI_ID` — auth (28-qism) gacha API qaysi foydalanuvchining vazifalari bilan ishlaydi (bazada bo'lmasa — ishga tushmaydi).
- `PG_POOL_MAX` (sukut 10), `PG_STATEMENT_TIMEOUT` (ms, sukut 5000). Server to'xtaganda pool yopiladi (`jarayon.ts` → `oxirida`).
- Xotira omboridan farqi: o'chirish yumshoq (qator qoladi); faol vazifalar orasida takror matn (registrga befarq) — `409 takror-matn`;
  rad etilgan INSERT ham id raqamini "yeydi" (sequence).
- Testlar: `TEST_DATABASE_URL` (sukut `postgres://postgres@127.0.0.1:5499/vazifalar_test`, sxema namunasiz qurilgan); baza bo'lmasa Postgres testlari SKIP.

## Prisma 7, migratsiyalar, seed, Redis kesh (27-qism)
- `SAQLASH=prisma` — `PrismaOmbori` (Prisma 7.10, `@prisma/adapter-pg`); `SAQLASH=postgres` — `PgOmbori` (pg). Ikkalasi bir xil shartnoma testlaridan o'tadi.
- Client generatsiyasi: `npm install` dan keyin avtomatik (`postinstall: prisma generate`) → `src/generated/prisma` (git'da yo'q).
- **Sxema manbai — SQL migratsiyalar** `prisma/migrations/` (`0_init` = 26-qism sxemasi + 27 qo'shimchalari: trigger, funksiya, CHECK, EXCLUDE, RLS, view,
  materialized view — Prisma sxemasi ularni ifodalay olmaydi). `prisma/schema.prisma` — client uchun model tavsifi. Yangi o'zgarish:
  `npx prisma migrate dev --create-only --name <nom>` → SQL'ni qo'lda tekshirish/to'ldirish → `npx prisma migrate dev`.
- Yangi baza: `npm run db:migrate` (`prisma migrate deploy`). **Mavjud baza** (sxema qo'lda qurilgan) birinchi marta: `npx prisma migrate resolve --applied 0_init`.
- Deploy tartibi: (1) `npm run db:migrate` — alohida qadam, server o'zi migratsiya qilmaydi; (2) server ishga tushadi. `NODE_ENV=production` da baza
  migratsiyalari koddagidan orqada bo'lsa server ishga TUSHMAYDI (`migratsiyalar kutilmoqda: …`). `prisma migrate deploy` migratsiyani tranzaksiyaga
  o'ramaydi — yarmida yiqilsa `npx prisma migrate resolve --rolled-back <nom>` va qo'lda tuzatish.
- Demo ma'lumot: `npm run db:seed` (`SEED_FOYDALANUVCHI=20`, deterministik, faqat `…@seed.example` foydalanuvchilarni almashtiradi; production'da ishlamaydi).
- Redis kesh (ixtiyoriy): `REDIS_URL=redis://127.0.0.1:6380` (+ `KESH_TTL`, sukut 60 s) — postgres/prisma ombori ustiga `KeshliOmbor` (avlod kaliti
  bilan invalidatsiya). Redis o'chsa API keshsiz ishlashda davom etadi (log'da ogohlantirish). **Diqqat:** bazani qayta qursangiz (`migrate reset`, qur.sh)
  Redis'dagi `vz:*` kalitlarini ham o'chiring — avlod raqami qaytadan boshlanib, eski kesh ko'rinishi mumkin.
- Prod o'rnatish: `npm ci --omit=dev --omit=optional` — `--omit=dev` yetarli EMAS: `@prisma/client` ning ixtiyoriy peer'lari (`prisma` CLI, `typescript`)
  baribir o'rnatiladi (15 → 322 MB); `--omit=optional` bilan 89 MB.

## Prodakshn va AI (31-qism, v4)
- **AI** (`AI_PROVAYDER=gemini`, `GEMINI_API_KEY` — faqat `.env`): vazifani qadamlarga bo'lish (`POST /v1/vazifalar/:id/qadamlar`, JSON yoki SSE), semantik qidiruv
  (`GET /v1/qidiruv`, pgvector), yordamchi (RAG, `POST /v1/yordamchi/savol`); kunlik kvota, kesh, retry/circuit breaker/bulkhead, zaxira model, feature flag'lar.
  Postgres image — `pgvector/pgvector:pg18` (`CREATE EXTENSION vector`). OpenAI-mos va Anthropic provayderlari — kodda bor, SINALMAGAN.
- **MCP server**: `npm run build && npm run mcp` (stdio; `VAZIFALAR_API_URL`, `VAZIFALAR_API_KALITI` — API kalit) — Claude Desktop / Claude Code'ga ulash mumkin.
- **Ma'lumotlar**: vazifa hodisalari (oyma-oy bo'limlar), saqlash muddati (ishchi har kuni 04:15), hisobni o'chirish (`DELETE /v1/auth/men`), audit jurnali (`audit` sxemasi).
  Qonun xaritasi — `docs/MAXFIYLIK.md`.
- **Kuzatuv**: `/health/live|ready|startup`, `/metrics` (Prometheus), `YOPISH_KECHIKISH_MS` (graceful drain).
