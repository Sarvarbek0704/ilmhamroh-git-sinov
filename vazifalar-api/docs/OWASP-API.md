# vazifalar-api — OWASP API Security Top 10:2023 auditi

28-qism #31 (B-134), 2026-10-28, holat 31. Manba: owasp.org/API-Security/editions/2023 (2023 — hozirgi oxirgi nashr). Umumiy veb ro'yxati (Top 10:2025) —
[XAVFSIZLIK.md](XAVFSIZLIK.md) §4. Bu jadval — tekshiruv ro'yxati: har qator uchun **zaiflik qanday ko'rinadi → qaysi test hujum qiladi → qanday yopilgan**.
"Topilgan" ustuni — kanonning o'zida (25–28-qism kodida) haqiqatan topilgan va tuzatilgan zaifliklar.

| # | Toifa | vazifalar-api'da qanday ko'rinadi | Test (hujum ssenariysi) | Himoya | Topilgan (28-qismda) |
|---|---|---|---|---|---|
| API1 | Broken Object Level Authorization (BOLA, IDOR) | `GET/PATCH/DELETE /v1/vazifalar/:id` — id ketma-ket son, boshqa odamnikini taxmin qilish oson | `owasp-api` API1, `sessiya`, `rls` (pg va prisma, `vazifalar_api` roli) | har so'rovda egasi sessiyadan; SQL'da `egasi_id`; **Postgres RLS** (`set_config` + eng kam huquqli rol) — WHERE unutilsa ham 0 qator; begona — **404** | **Idempotency-Key global edi** (Dilnoza Azizning javobini oldi), **eksport ishlari** egasiz edi (holat 07); 27 holatida API superuser bilan ulanib RLS'ni chetlab o'tardi (holat 20) |
| API2 | Broken Authentication | login, sessiya, parol tiklash, OTP, 2FA, API kalit | `auth`, `sessiya`, `email`, `otp`, `mfa`, `cheklov`, `api-kalit`, `owasp-api` API2 | argon2id (OWASP parametrlari), server sessiyasi (token hash, HttpOnly `__Host-`), aylantirish, bir xil javob (enumeration), tezlik cheklovi (hisob+IP), 2FA, bloklangan hisob markaziy tekshiruvda | parol tiklash so'rovi **vaqt bo'yicha** email borligini oshkor qilardi (30.0 / 12.8 ms → FonIshlar bilan 16.6 / 17.6 ms, holat 12); 2FA kodini cheklovsiz terish mumkin edi (holat 19 → 26) |
| API3 | Broken Object Property Level Authorization (BOPLA) | javobda ortiqcha maydon (parol hash, telefon); kiruvchi ortiqcha maydon (`egasiId`, `rol`) | `owasp-api` API3, `hujum` (mass assignment) | javob — aniq tanlangan ustunlar (`SELECT *` yo'q); kirish — Zod `strictObject` (oq ro'yxat, 25-qismdan) → 422 | yangi topilma yo'q (25-qism qarori ishladi) |
| API4 | Unrestricted Resource Consumption | login toshqini (argon2 — 19 MiB, ~70 ms), katta tana, `limit=100000`, ReDoS, SMS/xat yuborish | `cheklov`, `semafor`, `bot`, `owasp-api` API4; `tajriba/t29-dos` | tana 16 KB, sahifa ≤ 100, `statement_timeout`, Slowloris timeout'lari, **Postgres tezlik cheklovi**, **argon2 semafori (4 + navbat 64 → 503)**, SMS kunlik byudjet | 27 holatida 300 so'rov — 429 yo'q (holat 26 da yopildi); 200 parallel login paytida oddiy GET p99 **3 283 ms** (semafordan keyin 733 ms, holat 29) |
| API5 | Broken Function Level Authorization (BFLA) | `/v1/admin/*`, API kalit boshqaruvi, kalit bilan `/men` | `admin`, `api-kalit`, `owasp-api` API5 | `rolKerak` (rol har so'rovda bazadan — adminlikdan olinsa darhol 403); kalit ruxsatlari (`vazifalar:oqish`/`yozish`); kalit boshqaruvi faqat sessiya bilan | — |
| API6 | Unrestricted Access to Sensitive Business Flows | ro'yxat (bot hisoblar), parol tiklash va SMS (pumping — pul) | `bot`, `cheklov` | Turnstile (server tomonda siteverify), honeypot, IP chastotasi, SMS faqat ulangan raqamga, mamlakat ro'yxati, kunlik global byudjet | — (himoya #30 da qo'shildi, oldin yo'q edi) |
| API7 | Server Side Request Forgery (SSRF) | `WEBHOOK_URL` (29-qismda foydalanuvchi kiritadigan manzil) | `ssrf` | `xavfsizPost`: ichki IP ro'yxati (169.254.169.254 ham), o'z DNS tekshiruvimiz + IP'ga bog'langan ulanish (DNS rebinding), redirect qayta tekshiruvi, faqat https | 27 holatida `fetch(WEBHOOK_URL)` — hech qanday tekshiruvsiz (holat 28 da yopildi) |
| API8 | Security Misconfiguration | CORS, CSP, superuser ulanish, sukut sozlamalar, `trust proxy` | `cors.e2e`, `csrf.e2e`, `rls`, `cheklov` (XFF), `owasp-api` API8 | helmet (API uchun `default-src 'none'`), CORS ro'yxati env'dan, CSRF Origin tekshiruvi, ikki rol (`vazifalar_api`, `vazifalar_auth`), production'da config fail-fast | **eng kam huquq buzilgan edi**: sukut huquqlar `vazifalar_api` ga `sessiyalar`, `mfa_totp` ni ochgan (holat 07–19, 119 da REVOKE); **bir saytdagi boshqa origin `chiqish-hammasi` ni bajara olardi** (CSRF, holat 07 → 10); frontend dev proxy `changeOrigin: true` — CSRF tekshiruvi frontendni 403 qildi va **chiqish jim muvaffaqiyatsiz bo'lib, sessiya tirik qoldi** (frontend ulanishi) |
| API9 | Improper Inventory Management | versiyasiz eski yo'llar, hujjatda yo'q endpoint'lar | `owasp-api` API9, `t01-hujum-yuzasi` | ildizda faqat `/vazifalar`, `/teglar` (`Deprecation` + `Sunset`); API.md — to'liq ro'yxat | **25-qismdan beri butun v1 router ildizga ulangan edi** — `/eksportlar` va yangi `/auth/*` versiyasiz ham ochiq (holat 07) |
| API10 | Unsafe Consumption of APIs | Google OIDC, Telegram, Turnstile javoblari | `oidc`, `telegram`, `bot` | `openid-client` (state, nonce, PKCE, iss), Telegram hash/Ed25519 + muddat, Turnstile — `hostname` tekshiruvi, tarmoq xatosida **rad** (fail closed), timeout | Turnstile rasmiy test kaliti `hostname: example.com` qaytaradi — `TURNSTILE_HOSTNAME` bilan birga ishlatib bo'lmaydi (hujjat, holat 30) |

## Frontend tomoni (22-qism `vazifalar`, `natijalar/frontend-ulanish.diff`)

| Zaiflik | Qanday topildi | Tuzatish |
|---|---|---|
| Chiqishdan keyin brauzerda oldingi foydalanuvchining vazifalar nusxasi (`localStorage` + Query keshi) qolardi — **shu brauzerda kirgan boshqa odam uni ko'rdi** (13 ta begona vazifa, server so'rovisiz) | haqiqiy brauzer, `tajriba/t-frontend.mjs` | chiqishda, sessiya tugaganda va kirishda — foydalanuvchiga tegishli nusxa o'chiriladi, Query keshi tozalanadi |
| Server chiqishni rad etsa ham UI "chiqdi" ko'rsatardi, cookie va sessiya tirik qolardi | o'sha tajriba, `changeOrigin: true` bilan | UI faqat 2xx/401 dan keyin chiqadi; aks holda sabab ko'rsatiladi |
| `localStorage` dagi "kirgan" yozuv — ishonch manbai emas | qo'lda soxta yozuv | ochilganda `/v1/auth/men`; server 401 → yozuv o'chadi; ma'lumot yo'llari baribir 401 |

## Qolgan xavflar (ongli qarorlar, 29-qism va keyin)
- Tezlik cheklagichi buzilsa — **fail open** (so'rov o'tadi, jurnalga `cheklov_xato`); xavfsizlik ↔ mavjudlik tanlovi.
- Parol tiklash va xat — `FonIshlar` (jarayon o'lsa xat yo'qoladi); haqiqiy navbat — 29-qism.
- Servislararo HMAC nonce'lari — bitta jarayon xotirasida (ko'p nusxada Redis `SET NX` kerak).
- Production config hozircha **yopiq** (SMTP provayderi yo'q) — 29-qismgacha.
- Haqiqiy Google, Telegram, OneID, SMS va email provayderlari — sinalmagan (mock va hujjat).
