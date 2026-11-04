# vazifalar-api — API qo'llanmasi (v1)

Asosiy manzil: `/v1`. Hamma tana — JSON (`application/json; charset=utf-8`), xatolar — `application/problem+json`.

## Konvensiyalar

| Masala | Qaror | Nega |
|---|---|---|
| Maydon nomlari | `camelCase`, o'zbekcha (`bajarildi`, `yangilandi`) | frontend (22-qism) shu nomlarni ishlatadi; JS'da `snake_case` begona |
| Resurs nomlari | ko'plik, kichik harf, `kebab-case` (`/vazifalar`, `/eksportlar`) | Google AIP / Zalando bilan bir xil |
| ID | musbat butun **son** (`id: 7`) | frontend `z.int()` kutadi, Postgres `identity` (26-qism). Google AIP satr tavsiya qiladi — 2^53 dan katta bo'lsa satrga o'tiladi (buzuvchi → v2) |
| Sana-vaqt | ISO 8601, **UTC**, `Z` bilan (`2026-10-24T05:24:13.924Z`) | vaqt mintaqasi — faqat ko'rsatishda (mijozda) |
| Yo'q qiymat | maydon **berilmaydi**; `null` faqat ma'nosi bo'lsa (`sahifa.keyingi: null` — keyingi sahifa yo'q) | `null` va "yo'q" farqi aniq |
| Enum | kichik harfli satr (`"kutilmoqda"`, `"tayyor"`) | son emas — o'qiladi, yangisini qo'shish buzmaydi |
| Pul | (bu API'da yo'q) — kerak bo'lsa butun son tiyinda + `valyuta: "UZS"` | float yaxlitlash xatosi |
| Bo'sh ro'yxat | `[]` (200), 404 emas | |
| Noma'lum query parametr | **400** | xato yozilgan filtr jim e'tiborsiz qolmasin |

## Endpointlar

| Metod | Yo'l | Javob |
|---|---|---|
| GET | `/v1/vazifalar` | 200 `{ versiya, vazifalar, sahifa }` + `Link: <…>; rel="next"` |
| POST | `/v1/vazifalar` | 201 + `Location`, `ETag`; `Idempotency-Key` qo'llanadi |
| PUT | `/v1/vazifalar` | 200 `{ versiya, vazifalar }` — butun ro'yxat almashtiriladi (atomik) |
| POST | `/v1/vazifalar/toplam` | 201 yoki **207** `{ natijalar: [{ indeks, holat, vazifa? , xato? }] }` (1..100 element) |
| GET | `/v1/vazifalar/:id` | 200 + `ETag: "<versiya>"`, `Last-Modified`; `If-None-Match` → 304 |
| PUT | `/v1/vazifalar/:id` | 200 — `matn` va `bajarildi` majburiy; `If-Match` → 412 |
| PATCH | `/v1/vazifalar/:id` | 200 — `application/json` yoki `application/merge-patch+json`; `If-Match` → 412 |
| DELETE | `/v1/vazifalar/:id` | 204; `If-Match` → 412 |
| GET | `/v1/teglar` | 200 `{ teglar: [{ teg, soni }] }` |
| POST | `/v1/eksportlar` | **202** + `Location: /v1/eksportlar/:id` + `Retry-After` |
| GET | `/v1/eksportlar/:id` | 200 `{ id, holat, tayyor, jami, fayl? }` (+ `Retry-After` tayyor bo'lguncha) |
| GET | `/v1/eksportlar/:id/fayl` | 200 `text/csv` (1 soat saqlanadi) |
| GET | `/v1/vazifalar/oqim` | 200 `text/event-stream` (SSE): `vazifa.yaratildi`, `vazifa.yangilandi`, `vazifa.bajarildi`, `vazifa.ochirildi`, `vazifa.royxat-almashtirildi`; har 25 s `ping` |
| GET | `/health/live`, `/health/ready` | 200 / **503** (versiyasiz; orkestrator uchun: tiriklik va tayyorlik — ombor, xotira) |
| GET | `/docs`, `/docs-json` | Swagger UI va OpenAPI 3 JSON (kirish sxemalari — Zod'dan) |

`POST /v1/vazifalar/toplam` (v2.0.0 dan): har element o'z statusi bilan — takror matn (409) boshqa elementlarni bekor qilmaydi (207).

Ro'yxat parametrlari: `bajarildi`, `teg` (takrorlanadi — hammasi), `q`, `sort=-yaratildi,matn`, `fields=matn,teglar`, `limit` (1..100, sukut 20),
`offset` yoki `cursor` (birga emas), `jami=true`.

## Autentifikatsiya (28-qism)

Ma'lumot yo'llari (`/v1/vazifalar`, `/v1/teglar`, `/v1/eksportlar`) — sessiya cookie'si yoki `Authorization: Bearer vz_<8>_<43>` (API kalit) bilan; yo'q → **401**.
Cookie bilan o'zgartiruvchi so'rov boshqa origin'dan → **403 `csrf`**. Hamma `/v1/auth` yo'llari — JSON, javob matnlari email/telefon borligini oshkor qilmaydi.

| Metod | Yo'l | Javob |
|---|---|---|
| POST | `/v1/auth/royxat` `{ email, toliqIsm, parol }` | 202 (har doim bir xil; email tasdiq xati) |
| POST | `/v1/auth/email-tasdiq` `{ token }` · `/email-tasdiq/qayta` | 200 + sessiya · 202 |
| POST | `/v1/auth/kirish` `{ email, parol, eslabQol? }` | 200 `{ foydalanuvchi }` + cookie; 2FA yoqilgan — `{ mfa: "kerak" }`; 401 / 403 (tasdiqlanmagan, bloklangan) / 429 |
| GET | `/v1/auth/men` | 200 `{ foydalanuvchi, sessiya }` |
| POST | `/v1/auth/chiqish` · `/chiqish-hammasi` | 204 |
| GET / DELETE | `/v1/auth/sessiyalar` · `/sessiyalar/:id` | qurilmalar ro'yxati / bittasini bekor qilish |
| POST | `/v1/auth/parol-tiklash/sorov` `{ email }` · `/parol-tiklash` `{ token, parol }` | 202 · 204 (hamma sessiya bekor) |
| POST | `/v1/auth/otp/yubor` · `/otp/kirish` · `/telefon` · `/telefon/tasdiq` | SMS kod bilan kirish / raqam ulash |
| GET | `/v1/auth/oidc/:provayder` → `/oidc/:provayder/qaytish` | Google (PKCE, state, nonce) |
| POST | `/v1/auth/telegram` · `/telegram/ulash` | Telegram Login / Mini App initData |
| POST | `/v1/auth/2fa/sozlash` · `/2fa/yoqish` · `/2fa/tekshir` · `/2fa/ochirish` | TOTP, zaxira kodlar |
| POST / GET | `/v1/auth/passkey/royxat/boshla|yakun`, `/passkey/kirish/boshla|yakun`, `/passkeylar` | WebAuthn |
| GET / POST / DELETE | `/v1/auth/api-kalitlar`, `/:id/aylantirish`, `/:id` | API kalitlar (faqat sessiya bilan) |
| GET / POST | `/v1/admin/foydalanuvchilar`, `/:id/bloklash`, `/:id/blokdan-chiqarish` | faqat `admin` roli (403 `ruxsat-yoq`) |

Cheklangan yo'llarda `RateLimit-Policy` va `RateLimit` sarlavhalari; oshsa **429 `tezlik-cheklovi`** + `Retry-After`. Server band (parol hash navbati) — **503 `server-band`**.


## Integratsiyalar (29-qism; 30-qism C — Nest controller'lari, xulq 29 bilan bir xil)
Hammasi `/v1` ostida, 28 sessiyasi yoki API kaliti bilan (anonim — 401), `RateLimit` — foydalanuvchi bo'yicha 600/daqiqa. Ochiq (sessiyasiz) — faqat imzoli havolalar.
| Metod va yo'l | Javob | Izoh |
|---|---|---|
| `POST /vazifalar/:id/ilovalar` (multipart `fayl`) | 201 + Location | oqim bilan S3 (MinIO), magic bytes, ≤ `FAYL_MAKS_MB`; 413/415 |
| `GET /vazifalar/:id/ilovalar`, `…/ilovalar.zip`, `…/ilovalar/:faylId` (`Range`, `?inline=1`, `?havola=1`) | 200 / 206 | begona — 404 |
| `DELETE /vazifalar/:id/ilovalar/:faylId` | 204 | |
| `POST /fayllar/forma` → `POST /fayllar/:id/tasdiq` | 201 → 200 | presigned POST (brauzer → S3), tasdiqda tur va sha256 |
| `PUT /vazifalar/:id/muddat` `{ muddat }` | 202 | outbox → ishchi eslatmani rejalaydi/bekor qiladi |
| `GET /bildirishnomalar`, `POST /bildirishnomalar/oqildi` | 200 | keyset kursor, o'qilmagan soni |
| `GET /push/kalit`, `POST`/`DELETE /push/obuna` | 200 / 201 / 204 | VAPID sozlanmagan — 404 |
| `POST`/`GET`/`DELETE /telegram/ulash` | 201 / 200 / 204 | deep link (10 daqiqa, bir martalik) |
| `POST`/`GET /webhooklar`, `DELETE /webhooklar/:id`, `GET /webhooklar/:id/yetkazishlar` | 201 / 200 / 204 | sir (`whsec_`) faqat yaratishda; ko'pi bilan 5; SSRF — 422 |
| `GET /oqim` (SSE) | 200 `text/event-stream` | `event: ozgardi`, `Last-Event-ID`, `retry: 2000`; `X-Jonli-Manba` — o'z oynasi |
| `GET`/`POST /obuna/:token` (ochiq) | 200 HTML / matn | RFC 8058 one-click |
| `POST /sms/callback?id=…` (ochiq) | 200 | Eskiz yetkazish holati, imzoli id |
| `/admin/navbat` (Bull Board) | 200 / 403 | faqat admin |

## Prodakshn va AI (31-qism)
| Metod va yo'l | Nima qiladi | Javob |
|---|---|---|
| `GET /v1/statistika/faollik?kunlar=1..366` | kunlik vazifa hodisalari (APP_TZ kuni): yaratildi, bajarildi, qaytarildi, ochirildi, tiklandi | 200 `{ tz, kunlar: [{ kun, <tur>: son }] }` |
| `DELETE /v1/auth/men` `{ parol }` | hisobni o'chirish (anonimlashtirish, `docs/MAXFIYLIK.md`) | 204; parol noto'g'ri — 403; parolsiz hisob — 409 |
| `POST /v1/vazifalar/:id/qadamlar` | AI: vazifani 2–8 qadamga bo'lish TAKLIFI (saqlanmaydi). `Accept: text/event-stream` — oqim: `event: qadam` … `tugadi` / `xato` | 200 `{ vazifaId, qadamlar: [{ matn, daqiqa }], model, tokenlar, urinishlar }`; AI band — 503 (+Retry-After), kechikdi — 504, yaroqsiz javob — 502 |
| `GET /v1/qidiruv?q=&rejim=semantik|gibrid&limit=` | ma'no bo'yicha qidiruv (pgvector; gibrid — FTS + vektor, RRF) | 200 `{ rejim, vazifalar: [{ id, matn, bajarildi, muddat, ball }] }` |
| `POST /v1/yordamchi/savol` `{ savol }` | RAG: o'z vazifalaringiz bo'yicha javob | 200 `{ javob, manbalar: [{ id, matn }], model, tokenlar }` |

| `GET /v1/bayroqlar` | joriy foydalanuvchi uchun baholangan feature flag'lar `{ "ai-qadamlar": true, … }` (qoidalar oshkor qilinmaydi) | 200 |
| `GET/PUT /v1/admin/bayroqlar[/:kalit]` (admin) | bayroqlar: `{ yoqilgan, foiz 0–100, rollar, foydalanuvchilar, tavsif }` — o'chiq xususiyat yo'li 404 `xususiyat-yoq` | 200 / 403 / 422 |
| `GET /v1/admin/audit?keyin=&limit=` (admin) | audit jurnali (faqat qo'shiladi, hash zanjiri) | 200 `{ yozuvlar, keyingi }` |
| `POST /v1/admin/audit/tekshir` (admin) | zanjir butunligi | 200 `{ butun, yozuvlar, buzilganlar: [{ id, sabab }] }` |
| `GET /v1/yordamchi/kvota` | bugungi AI sarfi va chegara (`AI_KUNLIK_SOROV`, `AI_KUNLIK_TOKEN`) | 200 `{ kvota: { sorovlar, tokenlar, chegara } }` |

AI yo'llari faqat `AI_PROVAYDER` sozlanganda (aks holda 404). Kunlik kvota tugasa — **429** `ai-kvota` (`Retry-After` — mintaqa yarim tunigacha); keshdan javob (`kesh: true`) kvota sarflamaydi.

**MCP server** (`npm run mcp`, stdio): `VAZIFALAR_API_URL`, `VAZIFALAR_API_KALITI` (API kalit, ruxsatlar bilan). Vositalar: `vazifalar_royxati`, `vazifa_qosh`, `vazifa_bajarildi`, `vazifani_qadamlarga_bol`; resurs `vazifa://{id}`.

## Kuzatuv (31-qism)
- `GET /health/live` — jarayon tirik; `GET /health/ready` — baza javob beradi va yopilish boshlanmagan (SIGTERM dan keyin 503); `GET /health/startup` — ishga tushish tugadi.
- `GET /metrics` — Prometheus (RED: `http_sorovlar_jami{metod,yol,status}`, `http_sorov_davomiyligi_soniya`; yo'l — marshrut shabloni); `METRIKA_TOKEN` bo'lsa Bearer.
- Problem Details `title` — o'zbekcha (RFC 9457 §4.2.1 mahalliylashtirishga ruxsat beradi): `Topilmadi`, `Ma'lumot noto'g'ri` …

## Xatolar katalogi (`type`: `https://vazifalar-api.example/xatolar/<kod>`)

| kod | status | qachon |
|---|---|---|
| `validatsiya` | 422 | tana qoidaga mos emas; `xatolar: [{ joy, xabar }]` |
| `parametr` | 400 | query yoki yo'l parametri noto'g'ri |
| `vazifa-topilmadi` | 404 | |
| `royxat-toldi` | 409 | 1000 ta vazifa |
| `versiya-mos-emas` | 412 | `If-Match` eskirgan; javobda joriy `ETag` |
| `idempotentlik-kalit` | 400 | `Idempotency-Key` yaroqsiz |
| `idempotentlik-boshqa-tana` | 422 | kalit boshqa tana bilan qayta ishlatildi |
| `idempotentlik-jarayonda` | 409 | shu kalitli so'rov hali bajarilmoqda (`Retry-After`) |
| `eksport-topilmadi` / `eksport-tayyor-emas` | 404 / 409 | |
| (`about:blank`) | 400/404/405/413/415/500 | umumiy HTTP xatolari, `title` — status matni |

Har xato javobida `sorovId` (= `X-Request-Id` sarlavhasi) — murojaatda shuni ayting.

## O'zgarishlar tarixi (changelog)
- 4.0.1 dan boshlab — [CHANGELOG.md](CHANGELOG.md) (conventional commit'lardan hosil qilinadi). Quyidagilar — eski qo'lda yozilgan qaydlar.
- **v4.0.0-alfa** (31-qism): `/metrics`, `/health/startup`, graceful drain, Problem `title` o'zbekcha, AI chidamliligi (retry, circuit breaker, bulkhead), Redis tezlik cheklagichi; vazifa hodisalari va statistika, saqlash muddati (30 kun / 180 kun / 13 oy), hisobni o'chirish; `GET /v1/auth/men` da `rol`; audit jurnali, feature flag'lar; AI: qadamlarga bo'lish, semantik qidiruv, yordamchi (RAG), kunlik kvota va kesh; MCP server.

- **v2.1.0** (30-qism B va C): 28-qism auth (sessiya, CSRF, RBAC + RLS, API kalitlar, OIDC, 2FA/passkey) va 29-qism integratsiyalari (fayllar, bildirishnomalar,
  push, SMS, Telegram, webhook obunalari, SSE `/v1/oqim`, muddat/eslatma — BullMQ, outbox) Nest'da. Ma'lumot yo'llari endi kirish talab qiladi (DEV — xotira/fayl — bundan mustasno).
  Versiyasiz eski yo'llar — faqat `/vazifalar`, `/teglar`. Global `WEBHOOK_URL` olib tashlandi.

- **v2.0.0** (30-qism): server NestJS 12 da (HTTP shartnomasi o'zgarmadi — 25–27 testlari o'tadi). Yangi: `/v1/vazifalar/oqim` (SSE), `/health/live|ready`, `/docs`.
  Tuzatish: `/toplam` — takror matn butun so'rovni yiqitmaydi (avval 409 qaytib, oldingi elementlar baribir yozilardi). 404 javoblarida ham `Cache-Control: private, no-cache`.

- **v1** (2026-10-24): `/v1` prefiksi; xatolar Problem Details; ro'yxat — `{ versiya, vazifalar, sahifa }`; `versiya` maydoni (ETag); eksport, toplam.
  Eski versiyasiz yo'llar (`/vazifalar`, `/teglar`) — **eskirgan** (`Deprecation`), **2027-01-24 da o'chiriladi** (`Sunset`).
