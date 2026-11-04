# 0001. Circuit breaker — har LLM modeliga alohida

- **Holat:** qabul qilingan
- **Sana:** 2026-11-03
- **Qatnashchilar:** backend jamoasi (32-qism #01)

## Kontekst

31-qismda AI provayderi `Zaxirali(Chidamli(asosiy))` bilan o'ralgan: zaxira modelga o'tish ham o'sha `ChidamliProvayder` orqali, ya'ni bitta
umumiy breaker. Regressiya testi (`test/breaker-regressiya.test.ts`, asosiy model doim 503, zaxira sog') ikki xatoni ko'rsatdi:

- 1 × 10 ketma-ket: zaxira muvaffaqiyati breaker hisoblagichini nolga qaytaradi — o'lik model **30** marta chaqirildi, breaker ochilmadi;
- 8 × 2 parallel: asosiy xatolar breaker'ni ochdi va **sog' zaxira ham to'sildi** — 16/16 javob `503`, zaxiraga 0 chaqiruv.

`git bisect run` (2-stsenariy) nuqsonni kiritgan commitni 3 qadamda topdi: chidamlilik qo'shilgan commit (31-qism #29).

## Qaror

Breaker holati model nomi bo'yicha (`Map<model, Breaker>`) saqlanadi; bulkhead (parallel chegarasi) — umumiy, chunki u ilova resursini himoya qiladi.
`ZaxiraliProvayder` asosiy breaker `ochiq` bo'lganda ham zaxiraga o'tadi. Butun zanjir ustida — umumiy muddat `AI_DEADLINE_MS` (25 s).

## Ko'rib chiqilgan muqobillar

| Variant | Afzallik | Kamchilik |
|---|---|---|
| Har modelga alohida breaker (tanlandi) | ikkala stsenariy to'g'ri; o'zgarish bitta faylda | breaker holati model nomiga bog'liq (nom o'zgarsa — yangi holat) |
| O'ramlar tartibi: `Zaxirali(Chidamli(asosiy), Chidamli(zaxira))` | har provayder mustaqil | provayder ikki marta yaratiladi, zaxira boshqa provayder bo'lsa qulay — hozir kerak emas |
| Opossum paketi | tayyor, sinalgan | bog'liqlik; LlmXatosi turlari va Retry-After bilan baribir o'ram yozish kerak |

## Oqibatlar

O'lik asosiy model 5 chaqiruvdan keyin o'chiriladi (30 s), foydalanuvchi zaxiradan javob oladi. Metrikada breaker holatini model bo'yicha ko'rsatish —
keyingi ish (`good first issue`).
