# ADR: brauzer uchun server sessiyasi (JWT emas)

28-qism #11 (B-115). Holat: **qabul qilingan** (2026-10-27).

## Kontekst
`vazifalar` frontendi (22-qism) va `vazifalar-api` bir saytda ishlaydi: dev'da Vite proxy, 33-qismda bitta domen ostida nginx. Mijoz — brauzer (keyin
Telegram bot, 29-qism — u API kaliti bilan, #22). Talablar: chiqish darhol ishlasin, "barcha qurilmalardan chiqish", qurilmalar ro'yxati, XSS token o'g'irlay olmasin.

## Variantlar (ikkalasi haqiqiy kod bilan o'lchangan)

| Mezon | Server sessiyasi (kanon, `src/auth/sessiya.ts`) | Access JWT + refresh rotatsiya (`tajriba/t09-refresh.mjs`) |
|---|---|---|
| Har so'rovda tekshirish | 1 indeksli so'rov, mediana **1.6 ms** (t07) | imzo tekshiruvi **0.21 ms**, bazasiz (t09) |
| Chiqish / bloklash | **darhol** (`bekor_vaqti`) | refresh darhol, access **15 daqiqagacha amal qiladi** (t09 §2, §5) |
| O'g'irlangan token | sessiya bekor qilinadi | reuse detection oilani o'ldiradi, lekin 2 tab poygasida **soxta-musbat** chiqarish (t09 §4) |
| Saqlash joyi | HttpOnly cookie (`__Host-`, SameSite=Lax) | access — xotira/cookie, refresh — HttpOnly cookie |
| Sarlavha hajmi | cookie 58 belgi | access 298 belgi (har so'rovda) |
| Baza | `sessiyalar` (token hash) | `refresh_tokenlar` (oila, hash) + kalit aylantirish (JWKS) |
| Kod va xavf | kam: token, hash, muddat | ko'p: `alg`, `aud`, `exp`, kalitlar, oila, grace oynasi (t08: `alg:none`, kuchsiz sir) |

## Qaror
Brauzer uchun — **server sessiyasi** (Postgres). Sabab: bir sayt arxitekturasida JWT'ning asosiy afzalligi (bazasiz tekshirish, servislar orasida tarqatish) bizga kerak
emas, kamchiligi (darhol bekor qilib bo'lmaydi) esa kerakli funksiyalarga to'g'ridan zid. 1.4 ms farq HTTP so'rovning ~10 ms umumiy vaqti ichida (27 t58) sezilmaydi.

## Uzoq sessiyalar
- "Meni eslab qol" (`eslabQol: true`): cookie 30 kun (`Expires`), idle 7 kun — har so'rovda suriladi (sliding, `oxirgi_faollik` 60 s qadam bilan).
- Belgilanmasa: cookie `Expires`'siz (brauzer yopilganda o'chadi), idle 12 soat, mutlaq 7 kun (bazada).
- Qurilmalar: `GET /v1/auth/sessiyalar`, bittasini bekor qilish — `DELETE /v1/auth/sessiyalar/:id`, hammasi — `POST /v1/auth/chiqish-hammasi`.

## Qachon qayta ko'riladi
Mobil ilova (cookie'siz) yoki boshqa servis foydalanuvchi nomidan so'rov yuborsa — qisqa JWT (EdDSA, `aud` aniq) yoki OAuth 2.0 token (#14–#15) qo'shiladi;
dastur-dastur so'rovlari — API kaliti / HMAC (#22).

## 30-qism: NestJS'da (holat 43) — qaror o'zgarmadi
| Savol | Qaror | Dalil (`sinov/30/natijalar/tajriba/`) |
|---|---|---|
| Sessiya yoki JWT | **sessiya qoladi** | `tB-passport-jwt-casl.txt`: JWT HS256 tekshiruvi ~1.5× ko'p RPS (bazasiz), lekin "chiqish"dan keyin access token 15 daqiqa ishlaydi (200) — darhol bekor qilish, qurilmalar ro'yxati, bloklash talablariga zid |
| Passport | **ishlatilmaydi** — o'z `KirishGuard` (global, "yopiq sukut") + `kimlik` middleware | Passport strategiyasi (passport-custom) bilan tezlik bir xil (~2.4k RPS — baza hal qiladi); qo'shimcha 3 paket, 401 tanasi Problem Details emas va `WWW-Authenticate` yo'q. Passport kerak bo'ladi: ko'p tashqi provayder (strategiyalar tayyor) — bizda OIDC `openid-client` bilan to'g'ridan |
| `@Public`/`@Roles` | `@Ochiq()`, `@SessiyaKerak()`, `@Rollar("admin")` — global guard | `test/nest-auth.test.ts`: har marshrut anonimga 401, ochiqlari — aniq ro'yxat (inventar) |
| `@nestjs/throttler` | **28 limiteri qoladi** (`CheklovGuard`, `@Cheklov(...)`) | `tB-throttler.txt`: Postgres storage bilan teng; xotira storage'i sliding window (har kalitga zarba vaqtlari massivi) — ~2× sekinroq; kalit handler bo'yicha (umumiy "kirish-email" qoidasi uchun `generateKey` yozish kerak); sarlavhalar `X-RateLimit-*-<nom>`, `Retry-After-<nom>` (IETF `RateLimit` emas); "oshsa — CAPTCHA" ilgagi yo'q |
| CASL | **qo'shilmaydi** (2 rol + egalik; egalik — Postgres RLS) | `tB-passport-jwt-casl.txt`: qoidalar 28 bilan bir xil ifodalanadi, `can()` 0.36 µs; foydasi — atributli qoidalar ko'payganda. 7.1.0 — 7 kunlik qoidadan o'tmadi (2026-10-28), 7.0.2 sinaldi |
