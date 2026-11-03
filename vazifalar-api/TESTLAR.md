# vazifalar-api — testlar

`npm test` — **Vitest** (Nest 12 ESM sukuti; Vite 8 dekorator metama'lumotini o'zi chiqaradi). `npm run test:qamrov` — V8 coverage (entry point'lar `main.ts`, `buyruq.ts`
hisobga olinmaydi), chegaralar: satr 90 %, tarmoq 80 %, funksiya 90 % (2.0.0: satr 95.0, tarmoq 82.9, funksiya 93.8 %). 25–27-qism testlari (node:test) Vitest'ga
mexanik ko'chirilgan — **tanalari o'zgarmagan** (import va hook nomlari), HTTP shartnomasi bir xil. Sukut timeout — 20 s (vitest.config.ts; node:test'da timeout yo'q edi).

## Strategiya: integration ustun ("testing trophy")

Backend'ning qiymati — HTTP shartnomasi (status, sarlavha, Problem Details) va ma'lumot to'g'ri saqlanishi. Shuning uchun ko'p testlar
**haqiqiy HTTP so'rov → haqiqiy Nest ilovasi (`ilovaYarat`, main.ts dagi bilan bir xil middleware/pipe/filtr) → xotiradagi ombor** zanjirini tekshiradi.

| Daraja | Fayllar | Nima |
|---|---|---|
| Unit (toza funksiya) | `config`, `sana`, `sxema`, `rest` (sahifala) | config fail-fast, Toshkent kuni → UTC, Zod sxemalari, keyset |
| Unit (Nest DI) | `birlik` | `Test.createTestingModule` + `vi.fn` mock ombor, `overrideProvider`, guard / pipe / interceptor alohida |
| Shartnoma (contract) | `ombor`, `pg-ombor`, `prisma-ombor`, `kesh-ombor` | `omborShartnomasi()` — 5 ta ombor BIR XIL testdan o'tadi |
| HTTP integration (port 0) | `api`, `rest`, `middleware`, `xato`, `idempotentlik`, `shartli`, `toplam`, `log`, `sana`, `hodisa` | REST, xatolar, CORS, ETag/304, If-Match, idempotentlik, log korrelyatsiyasi, SSE, health |
| HTTP integration (supertest, portsiz) | `supertest`, `mock`, `hujjat` | `request(app.getHttpServer())` — listen'siz; OpenAPI |
| Nest tuzilmasi | `marshrutlar`, `ombor-modul` | Discovery bilan marshrut jadvali va 405 Allow; OmborModule (async fabrika, yopish), config xatosi |
| Jarayon | `jarayon`, `yopish` | unhandledRejection → exit 1 (bola jarayon — Vite runner, `test/qolip/yurgiz.mjs`), graceful shutdown |

## Qoidalar
- Har test o'z ilovasi/omborini yaratadi — testlar orasida holat yo'q (port 0 — parallel ishlaydi). `@Interval` bor — test oxirida `app.close()` (aks holda taymer qoladi).
- Vaqt va tasodif: `XotiraOmbori(soat)`, `XotiraIdempotentlikOmbori(soat)`, `EksportService.soat`, `sorovId(yangiId)` — ukol; yoki `vi.useFakeTimers({ toFake: ["Date"] })`.
- Tashqi HTTP: `webhookXabarchi(url, { fetchFn })` — soxta `fetch` (`vi.fn<typeof fetch>`). Tarmoqqa chiqadigan test yo'q.
- Shartli so'rovlar (`If-None-Match`) — `fetch` bilan EMAS: undici o'zi `Cache-Control: no-cache` qo'shadi va server 200 qaytaradi (`xomSorov` yoki supertest).
- Vitest'da o'tgan kod `nest build` (tsc) da yiqilishi mumkin (ESM aylanma import + dekorator metama'lumoti — oxc va tsc farqi): CI'da `npm run build` ham shart.
- Coverage: bola jarayonda ishlagan kod (`jarayon.ts`) Vitest coverage'ga tushmaydi (node:test'da tushardi).

## Postgres (26-qism)
- `test/pg-ombor.test.ts` — xotira va fayl omborlari o'tgan **o'sha** shartnoma (`ombor-shartnoma.ts`) + Postgres'ga xos holatlar: yumshoq o'chirish,
  trigger teglari, takror matn → 409, egasi ajratilganligi, injection (parametr, `Object.hasOwn` oq ro'yxat), ms kursor, PUT atomikligi,
  ulanish uzilishi (`pg_terminate_backend`), raqobat (parallel `yarat` tartibi, PATCH + PUT deadlock'siz, optimistik versiya).
- Har test boshida `TRUNCATE … RESTART IDENTITY` — bo'sh ombor, id 1 dan. Testlar bitta bazada ketma-ket (node:test fayl ichida parallel emas).
- Baza yo'q bo'lsa: `﹣ PgOmbori # test bazasi yo'q (…)` — SKIP, `npm test` yiqilmaydi.

## Prisma, kesh, migratsiya, Testcontainers (27-qism)
- `test/prisma-ombor.test.ts` — o'sha shartnoma + Postgres'ga xos holatlar; **alohida baza** `TEST_PRISMA_DATABASE_URL` (sukut `vazifalar_test_prisma`):
  test fayllari parallel jarayonlarda ishlaydi (node:test ham, Vitest ham) — bitta bazada TRUNCATE qilinsa testlar bir-birini buzadi.
- `test/kesh-ombor.test.ts` — `KeshliOmbor` (xotira ombori + Redis `TEST_REDIS_URL`, sukut `redis://127.0.0.1:6380`): shartnoma, hit/miss, avlod, TTL, Redis'siz ishlash.
- `test/migratsiya.test.ts` — server ishga tushishidagi migratsiya tekshiruvi (vaqtinchalik baza `vazifalar_test_mig`).
- `test/konteyner.test.ts` — **Testcontainers** (opt-in: `TESTCONTAINERS=1 npm test`, Docker kerak): `pgvector/pgvector:pg18` konteyner (31-qismdan: pgvector; nomi `kanon31-tc-*`, Ryuk o'chiq,
  tmpfs), `prisma migrate deploy`, snapshot → har testdan oldin `restoreSnapshot()` (template baza); cheklovlar, trigger'lar, FK, RLS va shartnoma testlari.
- `test/fabrika.ts` — test ma'lumoti factory'si (faker `uz_UZ_latin`, seed bilan deterministik).
- Tozalash usullari narxi (20 marta, mediana): TRUNCATE + ma'lumot ~100 ms, tranzaksiya + ROLLBACK ~19 ms, template'dan yangi baza ~350 ms (`natijalar/tajriba/t62-test-db.txt`).

## 31-qism (prodakshn va AI) testlari
- `test/statistika.test.ts` — vazifa hodisalari: trigger, oyma-oy bo'limlar (DEFAULT, DETACH + DROP), kunlik statistika.
- `test/saqlash.test.ts` — saqlash muddati funksiyalari, ishchi `saqlash-muddati` ishi (vazifalar_ishchi roli), `DELETE /v1/auth/men` (anonimlashtirish).
- `test/ai.test.ts`, `test/ai-qidiruv.test.ts`, `test/ai-nazorat.test.ts`, `test/mcp.test.ts` — AI: **SOXTA provayder** (`src/ai/soxta.ts`) — `npm run check` tashqi API'ga BORMAYDI.
  Qadamlar (JSON Schema + Zod, tuzatish so'rovi, SSE, mijoz uzilishi), zaxira model, semantik/gibrid qidiruv (pgvector), RAG manba tekshiruvi, kvota (parallelda atomik), kesh, MCP.
  Jonli Gemini tekshiruvi — alohida (kanon skriptlari, kalit muhitdan).
- `test/prodakshn.test.ts` — audit jurnali (hash zanjiri, o'zgarmaslik), feature flag'lar (foizli rollout), `/auth/men` da rol.
- `test/kuzatuv.test.ts`, `test/chidamlilik.test.ts`, `test/cheklov-redis.test.ts` — readiness/startup, `/metrics`, retry/circuit breaker/bulkhead, Redis cheklagichi.
- `test/breaker-regressiya.test.ts`, `test/nuqsonlar-31.test.ts` — 32-qism: 31 kanonida topilgan nuqsonlarning REGRESSIYA testlari (har modelga alohida breaker — ikki stsenariy;
  AI umumiy deadline; DEFAULT bo'limdan ko'chirish va fon xatosi metrikasi; `gemini-embedding-2` prefiksi; uzilgan oqim kvotasi). Breaker testi `git bisect run` uchun ham.
- `test/asinxron.test.ts` — vaqtga bog'liq kod soxta soat bilan (`vi.useFakeTimers`, `advanceTimersByTimeAsync`).
- `test/shartnoma.test.ts` — OpenAPI snapshot (`docs/openapi-snapshot.json`; ataylab o'zgartirganda `SHARTNOMA_YANGILA=1`) va iste'molchi shartnomasi (frontend kutgan javob shakllari).
- `npm run test:aralash` — testlar tasodifiy tartibda (bir-biriga bog'liq testlarni topish). CI — `.github/workflows/ci.yml` (qo'lda ishga tushadi; lokal `npm run check` bilan bir xil qadamlar).
