# Talab hujjati: takrorlanuvchi vazifalar

- **Holat:** muhokamada · **Muallif:** mahsulot + backend · **Sana:** 2026-11-04
- **Bog'liq issue:** epic "Takrorlanuvchi vazifalar" (sinov repo, `tur: epic`)

## 1. Muammo (nega)

Foydalanuvchilar bir xil vazifani qayta-qayta qo'lda yozadi ("Har dushanba hisobot", "Har oy elektr to'lovi"). Taxmin: faol foydalanuvchilarning
sezilarli qismi buni qiladi. **Bu raqam hali o'lchanmagan** — birinchi qadam: `vazifa_hodisalari` dan bir xil matnli `yaratildi` hodisalari
7/30 kun oralig'ida takrorlanishini sanash (SQL so'rovi 4-bo'limda). Raqam kichik chiqsa — xususiyat qilinmaydi.

## 2. Foydalanuvchi hikoyalari

1. Vazifa egasi sifatida men vazifani "har hafta dushanba" deb belgilamoqchiman, toki uni har safar qayta yozmay.
2. Vazifa egasi sifatida men takrorlanuvchi vazifani bajarganimda keyingisi o'zi paydo bo'lishini xohlayman, toki ro'yxatim doim to'g'ri tursin.
3. Vazifa egasi sifatida men takrorlashni to'xtatmoqchiman, eski bajarilganlar esa tarixda qolsin.

## 3. Qabul mezonlari (Berilgan / Qachonki / Unda)

- **1-hikoya:** Berilgan — "Hisobot" vazifasi; qachonki `PATCH /v1/vazifalar/:id` ga `takror: { tur: "haftalik", kun: 1 }` yuborsam; unda javobda
  `takror` maydoni va `keyingiMuddat` (Asia/Tashkent bo'yicha keyingi dushanba 00:00) bor.
- **2-hikoya:** Berilgan — haftalik vazifa; qachonki uni bajarilgan qilsam; unda **bitta** yangi vazifa keyingi muddat bilan yaratiladi
  (ikki marta bosilsa ham — bitta: idempotentlik), eskisi bajarilgan bo'lib qoladi.
- **3-hikoya:** Berilgan — takrorlanuvchi vazifa; qachonki `takror: null` yuborsam; unda yangi nusxalar yaratilmaydi, tarix o'zgarmaydi.

## 4. Chekka holatlar (oldindan aytilgan)

- Oyning 31-kuni → 30 kunlik oyda oxirgi kun; 29-fevral — kabisa bo'lmagan yilda 28-fevral.
- Foydalanuvchi muddatdan bir necha marta o'tib ketgan (3 hafta kirmagan) — 3 ta nusxa emas, **bitta** (keyingi muddat bugundan hisoblanadi).
- Vazifa o'chirilsa (yumshoq) — takrorlash ham to'xtaydi; tiklansa — qayta yoqilmaydi (aniq qaror).
- Vaqt mintaqasi: muddat foydalanuvchi mintaqasida, bazada — `timestamptz`.

O'lchov so'rovi (1-bo'lim): `SELECT egasi_id, lower(malumot->>'matn') …` — `vazifa_hodisalari` da matn YO'Q (31-qism qarori: hodisalar matnsiz);
demak o'lchov uchun `vazifalar` jadvalidan `GROUP BY egasi_id, lower(matn) HAVING count(*) >= 3` (o'chirilganlar bilan) — bu ham ochiq savol (maxfiylik).

## 5. Ustuvorlik (MoSCoW)

| | Nima |
|---|---|
| **Must** | kunlik / haftalik / oylik; bajarilganda keyingisi; to'xtatish |
| **Should** | "har 2 haftada" (interval); frontendda belgi |
| **Could** | ish kunlari; eslatma bilan bog'lash (29-qism bildirishnomalari) |
| **Won't (hozir)** | RRULE (iCalendar) to'liq; boshqa foydalanuvchiga takroriy vazifa |

MVP — faqat Must. Should — birinchi fikr-mulohazadan keyin.

## 6. Muvaffaqiyat o'lchovi

- Takrorlanuvchi vazifa qo'ygan faol foydalanuvchilar ulushi (30 kun); qo'lda takror yozilgan vazifalar soni kamayishi (1-bo'limdagi so'rov bilan, oldin/keyin).
- Qarshi metrika: noto'g'ri yaratilgan nusxalar (bir muddatga 2 ta) — 0 bo'lishi kerak (alert).

## 7. Bo'laklash (estimatsiya — story point, Fibonachchi; jamoa planning poker'da tasdiqlaydi)

| # | Issue | Bog'liqlik | SP |
|---|---|---|---|
| 1 | migratsiya: `vazifalar.takror jsonb`, CHECK (expand) | — | 2 |
| 2 | domen: `keyingiMuddat()` — toza funksiya + chekka holat testlari (31-kun, fevral, mintaqa) | — | 3 |
| 3 | API: PATCH `takror` (Zod), javobda `keyingiMuddat`; OpenAPI surati | 1, 2 | 3 |
| 4 | bajarilganda keyingi nusxa — tranzaksiyada, idempotent (ikki marta bosish testi) | 1, 2 | 5 |
| 5 | o'chirish/tiklash qoidasi + hodisalar | 4 | 2 |
| 6 | hujjat: API.md, CHANGELOG | 3–5 | 1 |

Jami 16 SP. Noaniqlik: 4-issue (konkurentlik) — eng xavfli, birinchi spike sifatida. "90 % tayyor" tuzog'i: issue faqat qabul mezonlari testda
o'tganda yopiladi, "kod yozildi" — tayyor emas.

## 8. Doiradan tashqarida

Frontend o'zgarishlari (alohida epic), push eslatmalar, jamoaviy (38-qism `jamoa`) vazifalar.
