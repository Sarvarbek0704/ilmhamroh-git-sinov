# O'zgarishlar tarixi

Format — [Conventional Commits](https://www.conventionalcommits.org/) dan `conventional-changelog -p conventionalcommits` bilan hosil qilinadi (32-qism #02);
versiyalar — [SemVer](https://semver.org/): `fix` → patch, `feat` → minor, `!`/`BREAKING CHANGE` → major. Qo'lda tahrirlanmaydi — commit xabarlari to'g'ri yozilsin.

## 4.0.1 (2026-11-04)

### Bug Fixes

* **ai:** har modelga alohida circuit breaker va umumiy deadline; 31-qism nuqsonlari (b3157bc)

## 4.0.0 (2026-11-02)

### Features

* **ai:** kunlik kvota va javob keshi (foydalanuvchi bo'yicha), AI hodisalari; MCP server (stdio, API kalit bilan) (ddeead9)
* **ai:** semantik qidiruv (pgvector HNSW, gibrid RRF), yordamchi (RAG, manba tekshiruvi), zaxira model (c39a485)
* **ai:** vazifani qadamlarga bo'lish — LLM provayder qatlami (Gemini), JSON Schema + Zod tekshiruvi, SSE oqim, xatolar 502/503/504 (34346db)
* audit jurnali (faqat qo'shiladi, hash zanjiri, @Audit interceptor), feature flag'lar (foizli rollout, segment, kill switch); /auth/men da rol (89abe02)
* **db:** vazifa hodisalari — oyma-oy bo'limli vaqt qatori (BRIN, trigger), /v1/statistika/faollik, bo'limlarni cron bilan tayyorlash (36b8d8f)
* graceful drain (readiness 503 + kechikish), /health/startup, Prometheus /metrics, AI chidamliligi (retry, circuit breaker, bulkhead), Redis tezlik cheklagichi; fix: buyruq CLS konteksti va logi stderr'ga, Problem title o'zbekcha (93a6b16)
* saqlash muddati va hisobni o'chirish — tozalash funksiyalari, anonimlashtirish, DELETE /v1/auth/men, MAXFIYLIK.md (b120fec)

## 3.0.0 (2026-11-02)

### Features

* **api:** 29-qism integratsiyalari NestJS'da — fayllar (MinIO), email, bildirishnomalar, Telegram, webhook obunalari, SSE, BullMQ va outbox (30-qism C) (13eff7f)
