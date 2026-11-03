# Shaxsiy ma'lumotlar: `vazifalar-api` nimani, qayerda, qancha saqlaydi (31-qism #11–#12)

Bu hujjat — dasturchining texnik xaritasi, yuridik maslahat EMAS. Qonun matni o'zgarib turadi — har chiqarishdan oldin lex.uz dagi amaldagi
tahrirni tekshiring.

## Manbalar (ko'rilgan sana — 2026-11-03)
- O'zbekiston Respublikasining "Shaxsga doir ma'lumotlar to'g'risida"gi Qonuni, O'RQ-547, 2019-07-02 — https://lex.uz/docs/4396419
  (sahifada o'zgartirishlar: 2021-01-15, 2021-04-21, 2023-11-29, 2026-03-27, 2026-07-14 — O'RQ-1158, 2026-09-12 — O'RQ-1174).
- 2026-yil mart o'zgarishi (lokalizatsiya torayishi) — ikkinchi mustaqil manba: Legal500 sharhi
  (https://www.legal500.com/developments/thought-leadership/legislative-updates-in-the-field-of-artificial-intelligence-and-personal-data-regulation-uzbekistan/)
  va Kun.uz (https://kun.uz/en/news/2026/03/28/uzbekistan-amends-personal-data-law-to-facilitate-global-payment-systems).
- GDPR (Yevropa Ittifoqi, 2016/679) — faqat Yevropadagi foydalanuvchilarga xizmat ko'rsatilsa; https://eur-lex.europa.eu/eli/reg/2016/679/oj

## Qonunning dasturchiga tegishli joylari (lex.uz matni bo'yicha, qisqa)
| Talab | Modda | `vazifalar-api` da |
|---|---|---|
| Lokalizatsiya: 2026-03 dan MAJBURIY faqat biometrik, genetik ma'lumot va mahalliy telekom foydalanuvchilari ma'lumoti; boshqasi — shartlar bilan chet elda ham | 27¹ | biometrik/genetik ma'lumot YO'Q (passkey — qurilmadagi kalit, server faqat ochiq kalitni saqlaydi); VPS O'zbekistonda bo'lsa — savol yo'q |
| Shaxsiy ma'lumotlar bazasini Davlat reyestrida ro'yxatdan o'tkazish — 27¹(2) dagi bazalar uchun (Davlat personallashtirish markazi) | 20 | majburiy toifalar yo'q — ro'yxatdan o'tish talabini mutaxassis bilan tasdiqlang |
| Rozilik (isbotlanadigan shaklda), maqsad o'zgarsa — yangi rozilik | 18, 19 | ro'yxatdan o'tishda maxfiylik siyosati; AI xususiyati yangi maqsad (matn tashqi provayderga yuboriladi) — alohida rozilik/ogohlantirish kerak (BOSH MUHARRIR QARORI) |
| Subyekt huquqlari: ma'lumotlarini bilish (10 kun), tuzatish (3 kun), yo'q qilish | 22, 30, 11, 17, 31 | `GET /v1/auth/men`, sozlamalar; hisobni o'chirish — `hisob_anonimlashtir()` (sql/302, #12) — `DELETE /v1/auth/men` |
| Maqsad tugasa / rozilik qaytarilsa — yo'q qilish; statistik maqsadda — anonimlashtirish | 17, 16, 31 | `ochirilganlarni_tozala(30 kun)`, hodisalar 13 oy (DROP bo'lim), `auth_hodisalar` 180 kun |
| Uchinchi shaxsga uzatishda subyektni xabardor qilish (3 kun) | 23 | AI provayderiga (Gemini) vazifa matni yuboriladi — maxfiylik siyosatida ochiq yozilsin |

Buzilish (breach) haqida majburiy xabar berish — qonun matnida umumiy talab TOPILMADI (lex.uz, 2026-11-03).

## Ma'lumotlar xaritasi va saqlash muddatlari (kanon)
| Ma'lumot | Jadval | Kim ko'radi | Saqlash | Qanday o'chadi |
|---|---|---|---|---|
| email, to'liq ism, parol hash | `foydalanuvchilar` | egasi (RLS), admin | hisob yashaguncha | hisob o'chirilsa — anonimlashtirish (email → `ochirilgan-<id>@ochirilgan.invalid`, ism — "O'chirilgan foydalanuvchi" (ustun NOT NULL), parol/kalitlar o'chadi) |
| vazifalar, izohlar, teglar | `vazifalar`, … | egasi | yumshoq o'chirishdan keyin 30 kun | `ochirilganlarni_tozala()` — haqiqiy DELETE (CASCADE) |
| sessiyalar, bir martalik tokenlar, OTP | `sessiyalar`, … | — | muddati + 7 kun | `auth_tozala()` |
| kirish hodisalari (IP, user-agent) | `auth_hodisalar` | admin | 180 kun | `auth_tozala()` |
| vazifa hodisalari (statistika) | `vazifa_hodisalari` | egasi | 13 oy | `hodisa_bolimlari_tozala()` — bo'lim DROP |
| AI kvotasi (son, token — matn emas; 31 #19 dan) | `ai_sarf` | egasi | hisob bilan | hisob o'chirilsa — anonimlashtirishda |
| AI so'rov matni | — | Google (Gemini) | provayder siyosati | bizda saqlanmaydi (logga ham — faqat model, token, ms) |

## GDPR asoslari (agar Yevropadagi foydalanuvchilar bo'lsa)
Qonuniy asos (6-modda), ma'lumotni minimallashtirish (5), unutilish huquqi (17), ko'chirish huquqi (20 — eksport bor: `/v1/eksportlar`), 72 soatda nazorat
organiga xabar (33), cookie banner — faqat zarur bo'lmagan cookie uchun (bizda faqat zarur sessiya cookie'si). SINALMAGAN: yuridik tekshiruv.
