# Hissa qo'shish

Rahmat! Bu fayl — loyihaga o'zgarish kiritishning kelishilgan yo'li. Qisqa bo'lishga harakat qildik: o'qish 5 daqiqa.

## Ish oqimi (GitHub flow)

1. **Issue** — katta ish oldidan issue oching yoki mavjudini oling ("men olaman" deb yozing). Kichik tuzatish (imlo, bitta qator) — issue'siz ham bo'ladi.
2. **Branch** — `main` dan: `git switch -c <tur>/<qisqa-nom>`. Tur — commit turi bilan bir xil: `feat/`, `fix/`, `docs/`, `test/`, `refactor/`, `chore/`.
   Misol: `fix/ai-deadline`, `docs/arxitektura`.
3. **Commit'lar** — [Conventional Commits](https://www.conventionalcommits.org/): `<tur>(<qamrov>): <nima>`. Qamrov — papka/modul: `ai`, `auth`, `db`, `api`.
   Xabar — buyruq maylida, kichik harf, nuqtasiz, ≤ 72 belgi. Nega — tanada. Buzuvchi o'zgarish — `feat!:` yoki tanada `BREAKING CHANGE:`.
   CHANGELOG va versiya shu xabarlardan hosil qilinadi — shuning uchun tur muhim (`fix` → patch, `feat` → minor, `!` → major).
4. **Tekshiruv** — `npm run check` (tip, lint, test, build). Push'dan oldin. Qizil bo'lsa — PR ochmang (draft bundan mustasno).
5. **PR** — shablonni to'ldiring. Kichik bo'lsin: ≈ 200–400 qator o'zgarish; kattasi — bir nechta ketma-ket PR'ga bo'linadi
   (masalan: 1) migratsiya va ombor, 2) xizmat va testlar, 3) controller va hujjat).
6. **Review** — kamida bitta tasdiq. Izohlarga javob bering yoki tuzating; "hal qilindi"ni izoh egasi bosadi. Merge — **squash** (bitta PR = `main` da bitta commit).
7. Merge'dan keyin branch o'chiriladi.

`main` himoyalangan: to'g'ridan-to'g'ri push, force push va o'chirish taqiqlangan — faqat PR orqali.

## Review madaniyati

- Izoh — kodga, odamga emas. Savol shaklida yozing: "Bu yerda `null` kelishi mumkinmi?" — "Bu xato" dan yaxshiroq.
- Muhimligini belgilang ([Conventional Comments](https://conventionalcomments.org/)): `muammo:` (merge'dan oldin tuzatish shart), `taklif:`, `savol:`, `nit:` (mayda, ixtiyoriy), `maqtov:`.
- 1 ish kuni ichida javob bering. Tasdiq mezoni: to'g'ri ishlaydi, test bor, xavfsizlik va ma'lumotlarga xavf yo'q, keyingi odam tushunadi.

## Kod uslubi

- TypeScript `strict`, `any` yo'q. ESLint va Prettier qoidalari `npm run lint` da.
- Identifikatorlar va izohlar — o'zbekcha (loyiha an'anasi); tashqi API maydonlari — o'zgarmaydi.
- Yangi muhit o'zgaruvchisi → `src/config.ts` (Zod) + `.env.example`. Sir hech qachon commit qilinmaydi.
- Migratsiya → `prisma/migrations/` (expand-contract: avval qo'shish, keyin olib tashlash — alohida reliz).

## Muloqot

- **Asinxron birinchi:** savol va qaror — issue yoki PR izohida (yozma, qidiriladi, yangi odam ham o'qiydi). Chat — tezkor savol uchun; chatda qabul qilingan qaror issue'ga ko'chiriladi.
- **Katta qaror** (kutubxona, arxitektura, ma'lumot modeli) — [ADR](docs/adr/): `docs/adr/0000-shablon.md` dan nusxa, PR bilan muhokama. Namuna — `0001-har-modelga-alohida-breaker.md`.
- **Yomon xabar erta:** muddatga ulgurmasangiz — bilgan kuningiz issue'da yozing (nima qoldi, nega, yangi taxmin).

## Inglizcha (xalqaro jamoa yoki open source uchun)

Loyiha tili — o'zbekcha. Begona loyihaga hissa qo'shsangiz — o'sha loyiha tilida (ko'pincha ingliz). Namunalar:

| Qayerda | Namuna |
|---|---|
| commit | `fix(ai): use a separate circuit breaker per model` — buyruq mayli (*use*, *add*, *fix*), "fixed/adding" emas |
| commit tanasi | `The shared breaker never opened under sequential load and blocked the healthy fallback under parallel load. Found with git bisect.` |
| PR sarlavhasi | `docs: add architecture overview and first-task guide` |
| review savoli | `Could this map grow without bound if the model name comes from the request?` |
| review taklifi | `nit: consider extracting 4 into a named constant (CHARS_PER_TOKEN).` |
| javob | `Good catch — fixed in 3f2a1c4.` / `I'd prefer to keep this PR small; opened #10 to track it.` |

## Xato haqida xabar berish

Issue oching ("Xato haqida xabar" shabloni — `.github/ISSUE_TEMPLATE/`): qadamlar (takrorlash uchun), kutilgan va haqiqiy natija, versiya (`package.json` yoki commit), log parchasi (sirlarsiz). Xavfsizlik zaifligi — **ochiq issue EMAS**: [SECURITY.md](SECURITY.md).


## Litsenziya

Hissa qo'shganingiz loyiha litsenziyasi (MIT, [LICENSE](LICENSE)) ostida tarqatilishiga rozilik bildiradi (inbound = outbound). Begona koddan nusxa olsangiz — uning litsenziyasi MIT bilan mos bo'lsin (MIT, BSD, Apache-2.0 — ha; GPL/AGPL kodini qo'shish butun loyihaning litsenziya shartlarini o'zgartiradi — avval issue'da muhokama).
