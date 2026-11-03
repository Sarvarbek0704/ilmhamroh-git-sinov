# vazifalar-api — xavfsizlik modeli

28-qism #01–#03 (S-01…S-03). Bu hujjat kod bilan birga yashaydi: har yangi endpoint yoki tashqi bog'liqlik qo'shilganda yangilanadi.

## 1. Aktivlar (nimani himoya qilamiz) va CIA

| Aktiv | C (maxfiylik) | I (yaxlitlik) | A (mavjudlik) |
|---|---|---|---|
| Foydalanuvchi vazifalari va izohlari | boshqa odam o'qimasin | faqat egasi o'zgartirsin | API ishlab tursin |
| Hisob ma'lumotlari (email, telefon, parol hash'i) | sizmasin | — | — |
| Sessiya / token / API kalit | o'g'irlanmasin | soxtalashtirilmasin | — |
| Baza (Postgres) | to'g'ridan kirish yo'q | migratsiya faqat deploy'da | zaxira (27 #14) |
| Sirlar (`.env`) | git'da, logda, javobda yo'q | — | — |

## 2. Ishonch chegaralari (trust boundaries)

```
brauzer (frontend, 22-qism) ──HTTPS──▶ nginx (33-qism) ──▶ vazifalar-api (Express) ──▶ Postgres (RLS)
          ▲                                                   │                        └─▶ Redis (kesh, ixtiyoriy)
   hujumchi sahifasi (CSRF)                                   └──▶ tashqi: webhook URL, OIDC provayder, SMS/email (mock)
```

Har chegara kesib o'tilganda: kirish tekshiriladi (Zod), kim ekanligi aniqlanadi (autentifikatsiya), nimaga ruxsati borligi tekshiriladi (avtorizatsiya).

## 3. Hujum yuzasi — 27-qism yakunidagi holat (holat 65, `natijalar/tajriba/t01-hujum-yuzasi.txt`)

| # | Kuzatuv (o'lchangan) | Xavf | Qayerda yopiladi |
|---|---|---|---|
| 1 | Hech qanday kalitsiz `GET /v1/vazifalar` — Azizning vazifalari (EGASI_ID config'dan) | A01, A07 | #05–#07 (ro'yxat, login, sessiya) |
| 2 | Begona `Origin` bilan `DELETE /v1/vazifalar/2` → 204 | A01 (CSRF) | #07, #10 |
| 3 | 300 ketma-ket so'rov — hammasi 200, 429 yo'q | API4 | #26 |
| 4 | API bazaga **superuser** `postgres` bo'lib ulanadi — RLS (27/105) chetlab o'tiladi; WHERE unutilsa 7 egasining 48 vazifasi | A01, A02 | #20 (`vazifalar_api` roli + `set_config`) |
| 5 | Idempotency-Key va eksport ishlari — bitta umumiy xotirada (foydalanuvchi bo'yicha ajratilmagan) | A01 (BOLA) | #07 (auth paydo bo'lishi bilan) |
| 6 | Kursor — ochiq base64 JSON (imzosiz, 25-qism qarori) | A08 | #20 (HMAC) |
| 7 | Xato javoblari — Problem Details, stack trace yo'q; `.env` → 404; 16 KB dan katta tana → 413 | ✓ | — |
| 8 | helmet sarlavhalari bor, `X-Powered-By` yo'q; `npm audit --omit=dev` — 0 | ✓ | #24 (CSP API uchun toraytiriladi) |

## 4. OWASP Top 10:2025 xaritasi (top10.owasp.org/2025, 2026-10-27 da o'qildi)

| Toifa | vazifalar-api'da qayer | 28-qism darsi |
|---|---|---|
| A01 Broken Access Control (SSRF ham shu yerda) | egalik (IDOR), CSRF, RLS, admin yo'llari, webhook URL | #10, #20–#22, #28 |
| A02 Security Misconfiguration | CORS, helmet/CSP, superuser ulanish, sukut sozlamalar | #24, #25, #20 |
| A03 Software Supply Chain Failures | `package-lock.json`, `npm audit`, aniq versiyalar, 7 kun qoidasi | #03, #18 |
| A04 Cryptographic Failures | parol hash, token hash, cookie, JWT imzo, TOTP siri | #04, #07, #08, #19 |
| A05 Injection | SQL (parametrlar), log/header injection, prototype pollution | #27 |
| A06 Insecure Design | enumeration, lockout, reset oqimi, SMS pumping | #05, #12, #13, #30 |
| A07 Authentication Failures | login, sessiya, MFA, passkey | #04–#19 |
| A08 Software or Data Integrity Failures | imzolangan kursor, webhook HMAC, Telegram hash, JWT `alg` | #16, #20, #22 |
| A09 Security Logging and Alerting Failures | kirish urinishlari, audit (`vazifa_tarixi.kim_id`), pino redact | #05, #07, #31 |
| A10 Mishandling of Exceptional Conditions | xato ishlovchi, "fail closed" (RLS NULL → 0 qator), timeout'lar | #29, #31 |

API'larga xos ro'yxat (OWASP API Security Top 10:2023) — #31, `docs/OWASP-API.md`.

## 30-qism (NestJS) — ko'chishda paydo bo'lgan va yopilgan xavflar
- Guard'lar middleware'dan KEYIN ishlaydi: kimlik/CSRF/egasi — Express middleware (`ilova.ts`), ruxsat — global guard'lar (tartib: Kirish → Cheklov → Captcha → 415).
  Idempotency-Key 401/403/429 javoblarini saqlamaydi.
- `VERSION_NEUTRAL` sukut bo'yicha HAMMA controller'ni versiyasiz ham ochardi (28 #07 dagi yashirin yo'llar) — faqat vazifalar/teglar'da.
- SSE oqimi va eksport ishlari xotirada (RLS himoya qilmaydi) — egasi bo'yicha filtr (`test/nest-auth.test.ts`).
- `/docs` (Swagger UI) — `'self'` CSP, qolgan hamma javob — `default-src 'none'`.
- BACKLOG (28 dan): login lockout DoS → CAPTCHA; OTP — hisob bo'yicha ≤ 100 ketma-ket xato (yangi SMS hisoblagichni nollamaydi); `email_verified: "true"`; `.env.example` superuser'siz.

## 30-qism C (29-qism integratsiyalari Nest'da)
- Yangi yo'llar ham "yopiq sukut" ostida (global KirishGuard); ochiq — faqat imzoli havolalar: `/v1/obuna/:token` (RFC 8058), `/v1/sms/callback?id=` (HMAC) — `test/nest-integratsiya.test.ts`.
- Fayl, bildirishnoma, webhook, Telegram SQL'larida RLS'dan tashqari `AND egasi_id/foydalanuvchi_id = $n` (29 holat 06 topilmasi — ikki qatlam).
- Bull Board — Express adapteri (Nest guard'i ishlamaydi) — o'z admin tekshiruvi `ilova.ts` da.
- One-click obuna sahifasi: API'ning qat'iy CSP'si `form-action 'none'` brauzerda formani to'sardi (29 da shunday edi) — sahifaga alohida CSP (`form-action 'self'`).
- Jonli tekshiruv haqiqiy rollar bilan: API — `vazifalar_api`, auth — `vazifalar_auth`, ishchi (relay, worker) — `vazifalar_ishchi` (superuser testlari 29 da outbox `RETURNING` 42501 ni yashirgan edi).
