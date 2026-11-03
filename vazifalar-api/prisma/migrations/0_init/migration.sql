-- 0_init — BASELINE (27-qism holat 36): 26-qism sxemasi (sinov/26/sql 001–014) + 27-qism P bosqichi (101, 103–106), namuna fayllarsiz.
-- Manba — SQL fayllar (Prisma sxemasi trigger, funksiya, CHECK, EXCLUDE, RLS, view, MV, generated ustunni ifodalay olmaydi — t36-migrate-diff.sql).
-- Mavjud bazada: npx prisma migrate resolve --applied 0_init (qayta bajarilmaydi). Yangi bazada: npx prisma migrate deploy.

-- ===== 001-jadvallar.sql =====
-- 001-jadvallar.sql — #12 (DB-09): birinchi ikki jadval va cheklovlar (constraint).
-- Nomlash (DB-37): jadval — ko'plikda, snake_case, lotin harflari apostrofsiz; cheklov nomi —
-- PostgreSQL'ning o'z andozasi: <jadval>_<ustun>_<pkey|key|fkey|check|idx>. Xato xabarida shu nom chiqadi.
-- Kalit: bigint GENERATED ALWAYS AS IDENTITY (#13 — tanlov va o'lchov).

CREATE TABLE foydalanuvchilar (
  id              bigint      GENERATED ALWAYS AS IDENTITY,
  email           text        NOT NULL,
  ism             text        NOT NULL,
  yaratilgan_vaqt timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT foydalanuvchilar_pkey PRIMARY KEY (id),
  -- to'liq email tekshiruvi — ilova ishi; baza faqat "@ bor, bo'shliq yo'q" ni kafolatlaydi
  CONSTRAINT foydalanuvchilar_email_check CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  CONSTRAINT foydalanuvchilar_ism_check CHECK (btrim(ism) <> '' AND char_length(ism) <= 100)
);

-- Email registrga befarq noyob: Aziz@Example.com va aziz@example.com — bitta odam.
-- UNIQUE (email) buni tutmaydi, ifoda ustidagi noyob indeks tutadi
CREATE UNIQUE INDEX foydalanuvchilar_email_key ON foydalanuvchilar (lower(email));

CREATE TABLE vazifalar (
  id              bigint      GENERATED ALWAYS AS IDENTITY,
  egasi_id        bigint      NOT NULL,   -- FK — #14 (002-tashqi-kalitlar.sql)
  matn            text        NOT NULL,
  bajarildi       boolean     NOT NULL DEFAULT false,
  yaratilgan_vaqt timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vazifalar_pkey PRIMARY KEY (id),
  -- frontend qoidasi (22-qism, Vazifa.MAKS_UZUNLIK = 100): bo'sh emas, chetida bo'shliq yo'q, ≤ 100 belgi
  CONSTRAINT vazifalar_matn_check CHECK (matn = btrim(matn) AND char_length(matn) BETWEEN 1 AND 100)
);

-- ===== 002-tashqi-kalitlar.sql =====
-- 002-tashqi-kalitlar.sql — #14 (DB-11): vazifa egasiz qolmasin.
-- 001 da egasi_id oddiy son edi: mavjud bo'lmagan foydalanuvchiga vazifa yozilardi (natijalar/14-*.txt).
-- ON DELETE CASCADE: foydalanuvchi o'chirilsa — uning vazifalari ham (vazifa egasiz ma'nosiz).
ALTER TABLE vazifalar
  ADD CONSTRAINT vazifalar_egasi_id_fkey
  FOREIGN KEY (egasi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE;

-- Postgres FK ustuniga indeksni O'ZI yaratmaydi. Kerak: (1) "foydalanuvchining vazifalari" so'rovi,
-- (2) foydalanuvchi o'chirilganda CASCADE vazifalarni qidiradi — indekssiz butun jadval o'qiladi
CREATE INDEX vazifalar_egasi_id_idx ON vazifalar (egasi_id);

-- ===== 004-muddat-ustuvorlik.sql =====
-- 004-muddat-ustuvorlik.sql — #21 (DB-18): ishlab turgan jadvalga yangi ustunlar (ALTER TABLE).
-- Ustuvorlik — ENUM (DB-36, #39): qiymatlar e'lon tartibida saralanadi (past < orta < yuqori);
-- matn + CHECK bo'lganda ORDER BY alifbo bo'yicha bo'lardi: orta, past, yuqori.
CREATE TYPE ustuvorlik AS ENUM ('past', 'orta', 'yuqori');

ALTER TABLE vazifalar
  -- DEFAULT bilan NOT NULL ustun: PG 11+ da jadvalni qayta yozmaydi (tez), mavjud qatorlar 'orta' oladi
  ADD COLUMN ustuvorlik      ustuvorlik  NOT NULL DEFAULT 'orta',
  ADD COLUMN muddat          timestamptz,           -- NULL = muddatsiz
  ADD COLUMN bajarilgan_vaqt timestamptz,
  ADD COLUMN ota_id          bigint;                -- kichik vazifa: qaysi vazifaning qadami (#27 rekursiv CTE)

-- Mavjud bajarilgan vazifalar qachon bajarilgani NOMA'LUM. Eng erta mumkin bo'lgan qiymat — yaratilgan vaqt
-- (namuna ma'lumotda 005 aniqroq vaqtlar bilan almashtiradi)
UPDATE vazifalar SET bajarilgan_vaqt = yaratilgan_vaqt WHERE bajarildi;

ALTER TABLE vazifalar
  -- ikki ustun bir-biriga zid bo'lmasin: bajarildi = true <=> bajarilgan_vaqt bor
  ADD CONSTRAINT vazifalar_bajarilgan_vaqt_check CHECK (bajarildi = (bajarilgan_vaqt IS NOT NULL)),
  ADD CONSTRAINT vazifalar_ota_id_check CHECK (ota_id <> id),
  -- kichik vazifa faqat O'SHA egasining vazifasiga ulanadi: tarkibiy (composite) FK (id, egasi_id) ga
  ADD CONSTRAINT vazifalar_id_egasi_id_key UNIQUE (id, egasi_id),
  ADD CONSTRAINT vazifalar_ota_id_fkey FOREIGN KEY (ota_id, egasi_id)
    REFERENCES vazifalar (id, egasi_id) ON DELETE CASCADE;

-- ko'p vazifaning otasi yo'q — indeks faqat ota_id bor qatorlarga (partial, #58)
CREATE INDEX vazifalar_ota_id_idx ON vazifalar (ota_id) WHERE ota_id IS NOT NULL;

-- ===== 006-teglar.sql =====
-- 006-teglar.sql — #23 (DB-20): teglar alohida jadvalda (N:M, #34). Manba — vazifa matnidagi #teg
-- (frontend shunday ishlaydi, 22-qism royxat.ts TEG). Teglar har foydalanuvchiniki: Azizning #uy i — Dilnozaniki emas.

CREATE TABLE teglar (
  id       bigint GENERATED ALWAYS AS IDENTITY,
  egasi_id bigint NOT NULL,
  nom      text   NOT NULL,
  CONSTRAINT teglar_pkey PRIMARY KEY (id),
  CONSTRAINT teglar_egasi_id_fkey FOREIGN KEY (egasi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE,
  -- teg kichik harfda saqlanadi (frontend ham toLowerCase qiladi), # bilan boshlanadi
  CONSTRAINT teglar_nom_check CHECK (nom ~ '^#' AND nom = lower(nom) AND char_length(nom) <= 50),
  -- ON CONFLICT (egasi_id, nom) shu cheklovga tayanadi
  CONSTRAINT teglar_egasi_id_nom_key UNIQUE (egasi_id, nom)
);

-- Bog'lovchi (junction) jadval: tarkibiy PRIMARY KEY — bir teg bir vazifaga ikki marta ulanmaydi
CREATE TABLE vazifa_teglari (
  vazifa_id bigint NOT NULL,
  teg_id    bigint NOT NULL,
  CONSTRAINT vazifa_teglari_pkey PRIMARY KEY (vazifa_id, teg_id),
  CONSTRAINT vazifa_teglari_vazifa_id_fkey FOREIGN KEY (vazifa_id) REFERENCES vazifalar (id) ON DELETE CASCADE,
  CONSTRAINT vazifa_teglari_teg_id_fkey FOREIGN KEY (teg_id) REFERENCES teglar (id) ON DELETE CASCADE
);
-- PK (vazifa_id, teg_id) "vazifaning teglari"ni topadi; "tegning vazifalari" uchun teskari indeks
CREATE INDEX vazifa_teglari_teg_id_idx ON vazifa_teglari (teg_id);

-- Matndan teglarni ajratish — frontend regex'ining Postgres (ARE) nusxasi: oldida harf/raqam/_/# bo'lmasin,
-- # dan keyin harf/raqam/_, ichida apostrof (' ‘ ’) faqat harflar orasida. [[:alnum:]] — bazaning lokali
-- bo'yicha (en_US.utf8: kirill va o'zbek harflari ham harf). IMMUTABLE — bir xil matnga doim bir xil natija
CREATE FUNCTION teglarni_ajrat(matn text) RETURNS SETOF text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT DISTINCT lower(m[1])
  FROM regexp_matches(matn, '(?<![[:alnum:]_#])(#[[:alnum:]_]+(?:[''‘’][[:alnum:]_]+)*)', 'g') AS m
$$;

-- Mavjud vazifalardan teglar: UPSERT — bor teg qayta qo'shilmaydi (ON CONFLICT DO NOTHING)
INSERT INTO teglar (egasi_id, nom)
SELECT DISTINCT v.egasi_id, t.nom
FROM vazifalar v CROSS JOIN LATERAL teglarni_ajrat(v.matn) AS t(nom)
ORDER BY 1, 2
ON CONFLICT (egasi_id, nom) DO NOTHING;

INSERT INTO vazifa_teglari (vazifa_id, teg_id)
SELECT v.id, tg.id
FROM vazifalar v
CROSS JOIN LATERAL teglarni_ajrat(v.matn) AS t(nom)
JOIN teglar tg ON tg.egasi_id = v.egasi_id AND tg.nom = t.nom
ON CONFLICT DO NOTHING;

-- ===== 007-izohlar.sql =====
-- 007-izohlar.sql — #34 (DB-31): 1:N — bitta vazifaning ko'p izohi. FK "ko'p" tomonda (izohlar.vazifa_id).
CREATE TABLE izohlar (
  id              bigint      GENERATED ALWAYS AS IDENTITY,
  vazifa_id       bigint      NOT NULL,
  -- muallif o'chirilsa izoh qoladi ("o'chirilgan foydalanuvchi") — SET NULL; hozir muallif = vazifa egasi,
  -- jamoaviy vazifalar — 38-qism capstone (`jamoa`)
  muallif_id      bigint,
  matn            text        NOT NULL,
  yaratilgan_vaqt timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT izohlar_pkey PRIMARY KEY (id),
  CONSTRAINT izohlar_vazifa_id_fkey FOREIGN KEY (vazifa_id) REFERENCES vazifalar (id) ON DELETE CASCADE,
  CONSTRAINT izohlar_muallif_id_fkey FOREIGN KEY (muallif_id) REFERENCES foydalanuvchilar (id) ON DELETE SET NULL,
  CONSTRAINT izohlar_matn_check CHECK (btrim(matn) <> '' AND char_length(matn) <= 2000)
);
-- "vazifaning izohlari, vaqt tartibida" — bitta indeks ham FK'ni, ham saralashni qoplaydi (#57)
CREATE INDEX izohlar_vazifa_id_yaratilgan_vaqt_idx ON izohlar (vazifa_id, yaratilgan_vaqt);
CREATE INDEX izohlar_muallif_id_idx ON izohlar (muallif_id);

-- ===== 009-hisoblangan.sql =====
-- 009-hisoblangan.sql — #36 (DB-33): hisoblangan (denormalizatsiya qilingan) ma'lumot trigger bilan sinxron.
-- 1) izohlar_soni — counter cache: ro'yxatda har vazifa uchun COUNT(*) qilmaslik uchun.
-- 2) vazifa_teglari — matndagi #teglardan avtomatik: ilova faqat matnni yozadi, teglar o'zi yangilanadi.
-- Narxi: har izoh yozish vazifa qatorini ham yangilaydi (qulf, #51), matn o'zgarsa teglar qayta yoziladi.

ALTER TABLE vazifalar ADD COLUMN izohlar_soni integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT vazifalar_izohlar_soni_check CHECK (izohlar_soni >= 0);

UPDATE vazifalar v SET izohlar_soni = s.soni
FROM (SELECT vazifa_id, count(*) AS soni FROM izohlar GROUP BY vazifa_id) s
WHERE s.vazifa_id = v.id;

CREATE FUNCTION izohlar_sonini_yangila() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE vazifalar SET izohlar_soni = izohlar_soni + 1 WHERE id = NEW.vazifa_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE vazifalar SET izohlar_soni = izohlar_soni - 1 WHERE id = OLD.vazifa_id;
  ELSIF NEW.vazifa_id <> OLD.vazifa_id THEN  -- izoh boshqa vazifaga ko'chirildi
    UPDATE vazifalar SET izohlar_soni = izohlar_soni - 1 WHERE id = OLD.vazifa_id;
    UPDATE vazifalar SET izohlar_soni = izohlar_soni + 1 WHERE id = NEW.vazifa_id;
  END IF;
  RETURN NULL;  -- AFTER trigger: qaytgan qiymat e'tiborga olinmaydi
END $$;

CREATE TRIGGER izohlar_soni_trg
AFTER INSERT OR DELETE OR UPDATE OF vazifa_id ON izohlar
FOR EACH ROW EXECUTE FUNCTION izohlar_sonini_yangila();

-- Teglar sinxroni: vazifa qo'shilganda yoki matni o'zgarganda
CREATE FUNCTION vazifa_teglarini_yangila() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO teglar (egasi_id, nom)
  SELECT NEW.egasi_id, t.nom FROM teglarni_ajrat(NEW.matn) AS t(nom)
  ON CONFLICT (egasi_id, nom) DO NOTHING;

  DELETE FROM vazifa_teglari vt
  WHERE vt.vazifa_id = NEW.id
    AND vt.teg_id NOT IN (SELECT tg.id FROM teglar tg JOIN teglarni_ajrat(NEW.matn) AS t(nom)
                          ON tg.egasi_id = NEW.egasi_id AND tg.nom = t.nom);

  INSERT INTO vazifa_teglari (vazifa_id, teg_id)
  SELECT NEW.id, tg.id FROM teglar tg JOIN teglarni_ajrat(NEW.matn) AS t(nom)
    ON tg.egasi_id = NEW.egasi_id AND tg.nom = t.nom
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;

-- UPDATE OF matn: trigger faqat SET ro'yxatida matn bo'lsa ishlaydi (bajarildi o'zgarsa — yo'q)
CREATE TRIGGER vazifa_teglari_trg
AFTER INSERT OR UPDATE OF matn ON vazifalar
FOR EACH ROW EXECUTE FUNCTION vazifa_teglarini_yangila();

-- ===== 010-vaqt-tarix.sql =====
-- 010-vaqt-tarix.sql — #38 (DB-35): yangilangan vaqt, yumshoq o'chirish (soft delete) va o'zgarishlar tarixi.

-- 1) yangilangan_vaqt — har mazmunli o'zgarishda trigger qo'yadi (ilova unutib qo'ymasin)
-- ochirilgan_vaqt (2-band) ham shu yerda: trigger ustunlar ro'yxatida u bor, ustun avval yaratilishi kerak
ALTER TABLE vazifalar ADD COLUMN yangilangan_vaqt timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN ochirilgan_vaqt timestamptz;
UPDATE vazifalar SET yangilangan_vaqt = coalesce(bajarilgan_vaqt, yaratilgan_vaqt);

CREATE FUNCTION yangilangan_vaqtni_qoy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.yangilangan_vaqt := now();  -- now() — tranzaksiya boshlangan vaqt
  RETURN NEW;                     -- BEFORE trigger: shu qator yoziladi
END $$;

-- Faqat foydalanuvchi o'zgartiradigan ustunlar: izohlar_soni (counter cache) o'zgarishi "tahrir" emas
CREATE TRIGGER vazifalar_yangilangan_trg
BEFORE UPDATE OF matn, bajarildi, ustuvorlik, muddat, ota_id, ochirilgan_vaqt ON vazifalar
FOR EACH ROW EXECUTE FUNCTION yangilangan_vaqtni_qoy();

-- 2) Yumshoq o'chirish: qator qoladi, ochirilgan_vaqt qo'yiladi ("Savat"dan tiklash mumkin)

-- Frontend qoidasi "Bu vazifa ro'yxatda allaqachon bor" (registrga befarq, 22-qism royxat.ts) — endi bazada.
-- Faqat O'CHIRILMAGANLAR orasida noyob: o'chirilgan vazifa matnini qayta yozish mumkin (partial unique, #58)
CREATE UNIQUE INDEX vazifalar_egasi_id_matn_key ON vazifalar (egasi_id, lower(matn))
  WHERE ochirilgan_vaqt IS NULL;

-- Ko'p so'rov "faqat o'chirilmaganlar" — ko'rinish (view) shartni har safar yozishdan saqlaydi
CREATE VIEW faol_vazifalar AS
  SELECT * FROM vazifalar WHERE ochirilgan_vaqt IS NULL;

-- 3) Tarix jadvali: kim, qachon, nimani o'zgartirdi. vazifa_id — FK EMAS: vazifa butunlay o'chsa ham tarix qoladi
CREATE TABLE vazifa_tarixi (
  id        bigint      GENERATED ALWAYS AS IDENTITY,
  vazifa_id bigint      NOT NULL,
  amal      text        NOT NULL,
  eski      jsonb,
  yangi     jsonb,
  -- kim: ilova har tranzaksiyada SET LOCAL ilova.foydalanuvchi_id = '…' qiladi (B bosqich); bo'lmasa NULL
  kim_id    bigint,
  vaqt      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vazifa_tarixi_pkey PRIMARY KEY (id),
  CONSTRAINT vazifa_tarixi_amal_check CHECK (amal IN ('INSERT', 'UPDATE', 'DELETE'))
);
CREATE INDEX vazifa_tarixi_vazifa_id_vaqt_idx ON vazifa_tarixi (vazifa_id, vaqt);

CREATE FUNCTION vazifa_tarixini_yoz() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  kim bigint := nullif(current_setting('ilova.foydalanuvchi_id', true), '')::bigint;
BEGIN
  INSERT INTO vazifa_tarixi (vazifa_id, amal, eski, yangi, kim_id)
  VALUES (
    coalesce(NEW.id, OLD.id), TG_OP,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - 'izohlar_soni' END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - 'izohlar_soni' END,
    kim);
  RETURN NULL;
END $$;

CREATE TRIGGER vazifa_tarixi_trg
AFTER INSERT OR DELETE OR UPDATE OF matn, bajarildi, ustuvorlik, muddat, ota_id, ochirilgan_vaqt ON vazifalar
FOR EACH ROW EXECUTE FUNCTION vazifa_tarixini_yoz();

-- ===== 011-yakuniy.sql =====
-- 011-yakuniy.sql — #40 (DB-37): sxema review natijasi — yakuniy A bosqich sxemasi.
-- Review topilmalari va qarorlar — QADAMLAR.md #40.

-- 1) Optimistik qulf (DB-49, B bosqich) uchun versiya: har mazmunli o'zgarishda +1.
--    Ilova: UPDATE ... WHERE id = $1 AND versiya = $2 — 0 qator = boshqa kimdir avval o'zgartirgan (409).
ALTER TABLE vazifalar ADD COLUMN versiya integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION yangilangan_vaqtni_qoy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.yangilangan_vaqt := now();
  NEW.versiya := OLD.versiya + 1;   -- ilova versiyani o'zi oshirmaydi — trigger kafolatlaydi
  RETURN NEW;
END $$;

-- 2) SELECT * bilan yaratilgan view ustunlar ro'yxatini YARATILGAN PAYTDA qotiradi: 010 dan keyin qo'shilgan
--    versiya faol_vazifalar da yo'q edi (natijalar/40-review.txt). Qayta yaratiladi — yangi ustunlar oxiriga.
CREATE OR REPLACE VIEW faol_vazifalar AS
  SELECT * FROM vazifalar WHERE ochirilgan_vaqt IS NULL;

-- 3) Asosiy so'rov uchun indeks (oldindan rejalashtirilgan, o'lchovi — B bosqich #57, #64):
--    "foydalanuvchining faol vazifalari, yangilari birinchi" + keyset pagination (yaratilgan_vaqt, id)
CREATE INDEX vazifalar_royxat_idx ON vazifalar (egasi_id, yaratilgan_vaqt DESC, id DESC)
  WHERE ochirilgan_vaqt IS NULL;

-- 4) Hujjat bazaning o'zida: \d+ va GUI klientlar shu izohlarni ko'rsatadi
COMMENT ON TABLE foydalanuvchilar IS 'Ilova foydalanuvchilari. Auth maydonlari (parol hash, sessiya) — 28-qism';
COMMENT ON TABLE vazifalar IS 'Vazifalar. Teglar matndagi #tegdan trigger bilan (vazifa_teglari); o''chirish — yumshoq (ochirilgan_vaqt)';
COMMENT ON COLUMN vazifalar.matn IS '1–100 belgi, chetida bo''shliqsiz; o''chirilmaganlar orasida egasi bo''yicha registrga befarq noyob';
COMMENT ON COLUMN vazifalar.ota_id IS 'Kichik vazifa bo''lsa — ota vazifa (o''sha egasiniki, tarkibiy FK)';
COMMENT ON COLUMN vazifalar.izohlar_soni IS 'Counter cache — izohlar_soni_trg yangilaydi; qo''lda yozilmaydi';
COMMENT ON COLUMN vazifalar.versiya IS 'Optimistik qulf: har tahrirda trigger +1 qiladi';
COMMENT ON COLUMN vazifalar.ochirilgan_vaqt IS 'NULL — faol; vaqt — Savatda (yumshoq o''chirilgan)';
COMMENT ON TABLE teglar IS 'Foydalanuvchining teglari, kichik harfda, # bilan';
COMMENT ON TABLE vazifa_teglari IS 'N:M — vazifa va teg; vazifa_teglari_trg matndan to''ldiradi';
COMMENT ON TABLE izohlar IS '1:N — vazifa izohlari';
COMMENT ON TABLE vazifa_tarixi IS 'Audit: har INSERT/UPDATE/DELETE ning eski va yangi qiymati (jsonb). kim_id — SET LOCAL ilova.foydalanuvchi_id';

-- ===== 013-api-tartib.sql =====
-- 013-api-tartib.sql — B bosqich (#41, holat 44): 25-qism API'si (vazifalar-api) talablari uchun sxema o'zgarishi.
-- 1) tartib — foydalanuvchi sudrab tartiblaydi (frontend 20-qism dnd-kit → PUT /v1/vazifalar massiv tartibi); sukut saralash: tartib, keyin id.
-- 2) vaqtlar millisekundgacha — JS Date (va API'dagi ISO satr, kursor) millisekundli; mikrosekund qolsa keyset kursor qatorni qayta
--    qaytaradi (kursordagi .123Z < bazadagi .123456). Trigger'lar va DEFAULT'lar endi date_trunc('milliseconds', now()).
-- 3) foydalanuvchilar.vazifalar_versiyasi — butun ro'yxat versiyasi (API RoyxatNatija.versiya, ro'yxat ETag'i); ombor har yozuvda +1 qiladi.

ALTER TABLE vazifalar ADD COLUMN tartib integer;
UPDATE vazifalar v SET tartib = t.n
FROM (SELECT id, row_number() OVER (PARTITION BY egasi_id ORDER BY yaratilgan_vaqt, id) AS n FROM vazifalar) t
WHERE t.id = v.id;
ALTER TABLE vazifalar ALTER COLUMN tartib SET NOT NULL;

-- tartib berilmasa — egasining oxirgi tartibidan keyin (BEFORE trigger NOT NULL tekshiruvidan OLDIN ishlaydi).
-- Parallel qo'shishda ikki vazifa bir xil tartib olishi mumkin — saralash id bilan tugaydi, shuning uchun tartib barqaror
CREATE FUNCTION tartibni_qoy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tartib IS NULL THEN
    SELECT coalesce(max(tartib), 0) + 1 INTO NEW.tartib FROM vazifalar WHERE egasi_id = NEW.egasi_id AND ochirilgan_vaqt IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vazifalar_tartib_trg BEFORE INSERT ON vazifalar FOR EACH ROW EXECUTE FUNCTION tartibni_qoy();

-- Sukut ro'yxat so'rovi: WHERE egasi_id ORDER BY tartib, id (+ keyset kursor)
CREATE INDEX vazifalar_tartib_idx ON vazifalar (egasi_id, tartib, id) WHERE ochirilgan_vaqt IS NULL;

-- Millisekund aniqlik
UPDATE vazifalar SET yaratilgan_vaqt = date_trunc('milliseconds', yaratilgan_vaqt),
                     yangilangan_vaqt = date_trunc('milliseconds', yangilangan_vaqt);
ALTER TABLE vazifalar ALTER COLUMN yaratilgan_vaqt SET DEFAULT date_trunc('milliseconds', now()),
                      ALTER COLUMN yangilangan_vaqt SET DEFAULT date_trunc('milliseconds', now());
CREATE OR REPLACE FUNCTION yangilangan_vaqtni_qoy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.yangilangan_vaqt := date_trunc('milliseconds', now());
  NEW.versiya := OLD.versiya + 1;
  RETURN NEW;
END $$;
-- tartib o'zgarishi ham tahrir (versiya +1): trigger ustunlar ro'yxati qayta yaratiladi
DROP TRIGGER vazifalar_yangilangan_trg ON vazifalar;
CREATE TRIGGER vazifalar_yangilangan_trg
BEFORE UPDATE OF matn, bajarildi, ustuvorlik, muddat, ota_id, ochirilgan_vaqt, tartib ON vazifalar
FOR EACH ROW EXECUTE FUNCTION yangilangan_vaqtni_qoy();

ALTER TABLE foydalanuvchilar ADD COLUMN vazifalar_versiyasi bigint NOT NULL DEFAULT 0;
UPDATE foydalanuvchilar f SET vazifalar_versiyasi = (SELECT count(*) FROM vazifalar v WHERE v.egasi_id = f.id);

-- SELECT * view yangi ustunni ko'rmaydi (#40 topilmasi) — qayta yaratiladi
CREATE OR REPLACE VIEW faol_vazifalar AS SELECT * FROM vazifalar WHERE ochirilgan_vaqt IS NULL;

COMMENT ON COLUMN vazifalar.tartib IS 'Foydalanuvchi tartibi (sudrab tartiblash); berilmasa trigger oxiriga qo''yadi';
COMMENT ON COLUMN foydalanuvchilar.vazifalar_versiyasi IS 'Ro''yxat versiyasi: ombor har yozuvda +1 (API ro''yxat ETag''i)';

-- ===== 014-matn-noyob-kechiktirilgan.sql =====
-- 014-matn-noyob-kechiktirilgan.sql — B bosqich (#53, holat 53): "faol vazifalar orasida takror matn yo'q" qoidasi endi buyruq OXIRIDA tekshiriladi.
-- Topilma (pg-ombor testi): PUT /v1/vazifalar (almashtirHammasi) ikki vazifaning matnini almashtirsa (id 2: "p1", id 5: "p2" → aksincha),
-- bitta UPDATE ... FROM unnest buyrug'i ichida ham UNIQUE INDEX har QATORDAN keyin tekshiriladi → 23505, garchi yakuniy holat to'g'ri bo'lsa ham.
-- Partial + ifoda indeksini DEFERRABLE qilib bo'lmaydi (faqat UNIQUE/PK/EXCLUDE cheklovlari). Yechim — teng ma'noli EXCLUDE cheklovi
-- (btree, = operatorlari — noyob indeks bilan bir xil), DEFERRABLE INITIALLY IMMEDIATE: tekshiruv buyruq oxirida; kerak bo'lsa
-- SET CONSTRAINTS ... DEFERRED bilan COMMIT'gacha. Xato kodi 23505 → 23P01 (ilova ikkalasini ham "takror" deb biladi).
DROP INDEX vazifalar_egasi_id_matn_key;
ALTER TABLE vazifalar ADD CONSTRAINT vazifalar_egasi_id_matn_excl
  EXCLUDE USING btree (egasi_id WITH =, lower(matn) WITH =) WHERE (ochirilgan_vaqt IS NULL)
  DEFERRABLE INITIALLY IMMEDIATE;
COMMENT ON CONSTRAINT vazifalar_egasi_id_matn_excl ON vazifalar IS 'Faol vazifalar orasida egasi bo''yicha registrga befarq noyob matn; buyruq oxirida tekshiriladi (PUT matnlarni almashtira oladi)';

-- ===== 101-sozlamalar-jsonb.sql =====
-- 101-sozlamalar-jsonb.sql — 27-qism #01 (DB-62, holat 01): foydalanuvchi sozlamalari — JSONB.
-- Nega JSONB: frontend sozlamalari (21-qism: til, mavzu, bildirishnoma) tez-tez o'zgaradi, har biri bo'yicha JOIN/hisobot qilinmaydi,
-- hammasi bitta obyekt bo'lib o'qiladi/yoziladi. Qidiriladigan, FK yoki qat'iy turli maydonlar — oddiy ustun bo'lib qoladi.
-- 27-qism fayllari 101 dan boshlanadi: 001–0NN — 26-qism kanoni (sinov/26/sql nusxasi), u tugaguncha yangi raqam qo'shishi mumkin.

ALTER TABLE foydalanuvchilar ADD COLUMN sozlamalar jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Faqat obyekt; ma'lum kalitlarning turi va qiymatlari tekshiriladi, noma'lum kalitlar — ruxsat (oldinga moslik)
ALTER TABLE foydalanuvchilar ADD CONSTRAINT foydalanuvchilar_sozlamalar_check CHECK (
  jsonb_typeof(sozlamalar) = 'object'
  AND (NOT sozlamalar ? 'til' OR sozlamalar->>'til' IN ('uz-Latn', 'uz-Cyrl', 'ru', 'en'))
  AND (NOT sozlamalar ? 'mavzu' OR sozlamalar->>'mavzu' IN ('yorug', 'qorongi', 'tizim'))
  AND (NOT sozlamalar ? 'bildirishnoma' OR jsonb_typeof(sozlamalar->'bildirishnoma') = 'object')
);

-- "Kim qorong'i mavzuda / kimga email bildirishnoma ketadi" — @> so'rovlari uchun (jsonb_path_ops — kichikroq, faqat @> va @?)
CREATE INDEX foydalanuvchilar_sozlamalar_idx ON foydalanuvchilar USING gin (sozlamalar jsonb_path_ops);

COMMENT ON COLUMN foydalanuvchilar.sozlamalar IS 'Interfeys sozlamalari: til, mavzu, bildirishnoma{email,telegram}; noma''lum kalitlar saqlanadi';

-- ===== 103-statistika-mv.sql =====
-- 103-statistika-mv.sql — 27-qism #04 (DB-65, holat 04): foydalanuvchi statistikasi — MATERIALIZED VIEW.
-- "Statistika" sahifasi (frontend 21-qism analitika) har so'rovda butun jadvalni agregatlamasin: natija saqlanadi, fon ishida
-- REFRESH ... CONCURRENTLY bilan yangilanadi (o'qishni to'smaydi; buning uchun UNIQUE indeks SHART). Ma'lumot biroz eskirgan bo'lishi
-- mumkin — `yangilangan` ustuni buni ochiq ko'rsatadi.

CREATE MATERIALIZED VIEW foydalanuvchi_statistikasi AS
SELECT f.id AS foydalanuvchi_id,
       count(v.id) AS jami,
       count(v.id) FILTER (WHERE v.bajarildi) AS bajarilgan,
       count(v.id) FILTER (WHERE NOT v.bajarildi AND v.muddat < now()) AS muddati_otgan,
       round(100.0 * count(v.id) FILTER (WHERE v.bajarildi) / nullif(count(v.id), 0), 1) AS bajarilgan_foiz,
       avg(v.bajarilgan_vaqt - v.yaratilgan_vaqt) FILTER (WHERE v.bajarildi) AS ortacha_bajarish,
       max(v.yaratilgan_vaqt) AS oxirgi_vazifa,
       now() AS yangilangan
FROM foydalanuvchilar f
LEFT JOIN vazifalar v ON v.egasi_id = f.id AND v.ochirilgan_vaqt IS NULL
GROUP BY f.id;

CREATE UNIQUE INDEX foydalanuvchi_statistikasi_pkey ON foydalanuvchi_statistikasi (foydalanuvchi_id);

COMMENT ON MATERIALIZED VIEW foydalanuvchi_statistikasi IS
  'Statistika sahifasi; REFRESH MATERIALIZED VIEW CONCURRENTLY bilan yangilanadi (fon ishi), yangilangan — oxirgi yangilanish vaqti';

-- ===== 104-qidiruv.sql =====
-- 104-qidiruv.sql — 27-qism #07 (DB-68, holat 07): vazifalar bo'yicha qidiruv — full-text (tsvector) + pg_trgm (xatoli yozuv).
-- O'zbek tili uchun Postgres'da lug'at (stemming) YO'Q → 'simple' konfiguratsiya (so'zni o'zgartirmaydi, faqat kichik harf).
-- Muammo (o'lchandi, natijalar/07-fts.txt): 'simple' parser oddiy apostrofni (') va ’ ni so'z ajratuvchi deb biladi:
--   o'qish → 'o' + 'qish'; ʻ (U+02BB) esa harf → 'oʻqish' bitta so'z. Yechim — normallashtirish: hamma apostrof shakllari → ʻ (U+02BB),
--   kirill → lotin (foydalanuvchi "ўқиш" deb qidirsa ham topilsin), unaccent (é → e). Shu funksiya ham matnga, ham so'rovga qo'llanadi.

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- IMMUTABLE va'dasi: unaccent() o'zi STABLE (lug'at o'zgarishi mumkin) — lug'atni aniq ko'rsatib o'rab IMMUTABLE deymiz
-- (generated ustun va indeks uchun shart). unaccent lug'ati yangilansa — REINDEX/qayta hisoblash kerak (izohda ochiq aytilgan).
CREATE FUNCTION uz_normal(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
-- tartib muhim (o'lchandi): unaccent ʻ ni ASCII ' ga aylantiradi va ё → е qiladi — shuning uchun 1) kirill → lotin,
-- 2) unaccent, 3) OXIRIDA hamma apostrof shakllari → ʻ
RETURN translate(
  public.unaccent('public.unaccent'::regdictionary,
    translate(
      replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
        lower(t),
        'ў', 'oʻ'), 'ғ', 'gʻ'), 'ш', 'sh'), 'ч', 'ch'), 'ё', 'yo'), 'ю', 'yu'), 'я', 'ya'), 'ц', 'ts'), 'щ', 'sh'), 'қ', 'q'), 'ҳ', 'h'), 'ъ', 'ʻ'),
      'абвгдежзийклмнопрстуфхэь',
      'abvgdejziyklmnoprstufxe')),
  'ʼ''’‘`´', 'ʻʻʻʻʻʻ');

ALTER TABLE vazifalar ADD COLUMN qidiruv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, uz_normal(matn))) STORED;

CREATE INDEX vazifalar_qidiruv_idx ON vazifalar USING gin (qidiruv);
-- Xatoli yozuv / so'z bo'lagi (ILIKE '%…%', similarity) uchun trigram
CREATE INDEX vazifalar_matn_trgm_idx ON vazifalar USING gin (uz_normal(matn) gin_trgm_ops);

-- SELECT * view yangi ustunni ko'rmaydi (26 #40 topilmasi) — qayta yaratiladi
CREATE OR REPLACE VIEW faol_vazifalar AS SELECT * FROM vazifalar WHERE ochirilgan_vaqt IS NULL;

COMMENT ON FUNCTION uz_normal(text) IS 'Qidiruv uchun: kichik harf, kirill→lotin, apostroflar→ʻ, unaccent. IMMUTABLE — unaccent lug''ati o''zgarsa REINDEX';
COMMENT ON COLUMN vazifalar.qidiruv IS 'to_tsvector(simple, uz_normal(matn)) — STORED generated, GIN indeks';

-- ===== 105-rls.sql =====
-- 105-rls.sql — 27-qism #09 (DB-70, holat 09): Row Level Security — har foydalanuvchi faqat o'z ma'lumotini ko'radi, BAZA darajasida.
-- Ilova `WHERE egasi_id = $1` ni unutsa ham boshqa odamning vazifasi chiqmaydi (ikkinchi himoya qatlami).
-- Ilova har tranzaksiyada: BEGIN; SET LOCAL ilova.foydalanuvchi_id = '<id>'; … COMMIT;  (SET emas — pool'da keyingi mijozga o'tadi; t09 o'lchovi).
-- Superuser va jadval egasi (postgres, migratsiya) RLS'ni chetlab o'tadi — siyosatlar faqat `vazifalar_ilova` roli orqali ishlaydi.
-- Rollar klaster darajasida (baza o'chirilsa ham qoladi) — shuning uchun IF NOT EXISTS.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vazifalar_ilova') THEN
    CREATE ROLE vazifalar_ilova NOLOGIN;
  END IF;
END $$;

-- Joriy foydalanuvchi: o'rnatilmagan YOKI bo'sh satr → NULL (hech narsa ko'rinmaydi — "yopiq holatda xavfsiz").
-- Bo'sh satr tuzog'i: SET LOCAL tugagach sessiyada '' qoladi, ''::bigint → xato (natijalar/09-rls.txt).
CREATE FUNCTION joriy_foydalanuvchi() RETURNS bigint
LANGUAGE sql STABLE PARALLEL SAFE
RETURN nullif(current_setting('ilova.foydalanuvchi_id', true), '')::bigint;

GRANT USAGE ON SCHEMA public TO vazifalar_ilova;
GRANT SELECT, INSERT, UPDATE, DELETE ON foydalanuvchilar, vazifalar, teglar, vazifa_teglari, izohlar TO vazifalar_ilova;
GRANT INSERT ON vazifa_tarixi TO vazifalar_ilova;        -- tarix trigger'i yozadi, ilova o'qimaydi
GRANT SELECT ON faol_vazifalar, foydalanuvchi_statistikasi TO vazifalar_ilova;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO vazifalar_ilova;

ALTER TABLE foydalanuvchilar ENABLE ROW LEVEL SECURITY;
ALTER TABLE vazifalar ENABLE ROW LEVEL SECURITY;
ALTER TABLE teglar ENABLE ROW LEVEL SECURITY;
ALTER TABLE vazifa_teglari ENABLE ROW LEVEL SECURITY;
ALTER TABLE izohlar ENABLE ROW LEVEL SECURITY;

CREATE POLICY foydalanuvchilar_ozi ON foydalanuvchilar TO vazifalar_ilova
  USING (id = joriy_foydalanuvchi());
CREATE POLICY vazifalar_egasi ON vazifalar TO vazifalar_ilova
  USING (egasi_id = joriy_foydalanuvchi())
  WITH CHECK (egasi_id = joriy_foydalanuvchi());          -- boshqa odam nomiga yozib/ko'chirib bo'lmaydi
CREATE POLICY teglar_egasi ON teglar TO vazifalar_ilova
  USING (egasi_id = joriy_foydalanuvchi()) WITH CHECK (egasi_id = joriy_foydalanuvchi());
-- Bog'lanish va izohlar — vazifa orqali (EXISTS ichidagi vazifalar ham RLS bilan filtrlanadi)
CREATE POLICY vazifa_teglari_egasi ON vazifa_teglari TO vazifalar_ilova
  USING (EXISTS (SELECT 1 FROM vazifalar v WHERE v.id = vazifa_id));
CREATE POLICY izohlar_vazifa_egasi ON izohlar TO vazifalar_ilova
  USING (EXISTS (SELECT 1 FROM vazifalar v WHERE v.id = vazifa_id))
  WITH CHECK (EXISTS (SELECT 1 FROM vazifalar v WHERE v.id = vazifa_id) AND muallif_id = joriy_foydalanuvchi());

COMMENT ON FUNCTION joriy_foydalanuvchi() IS 'SET LOCAL ilova.foydalanuvchi_id dan; o''rnatilmagan/bo''sh → NULL (RLS hech narsa ko''rsatmaydi)';

-- ===== 106-rollar.sql =====
-- 106-rollar.sql — 27-qism #11 (DB-72, holat 11): rollar va huquqlar — eng kam huquq tamoyili.
--   vazifalar_migratsiya — sxemani o'zgartiradi (DDL), jadvallar egasi bo'la oladi; ilova u bilan ISHLAMAYDI
--   vazifalar_ilova      — guruh (NOLOGIN, 105): faqat DML, RLS ostida
--   vazifalar_api        — LOGIN, vazifalar_ilova a'zosi (API jarayoni shu bilan ulanadi)
--   vazifalar_hisobot    — LOGIN, faqat o'qish (analitika, BI). RLS'ni chetlab o'tishi kerak — BYPASSRLS (ongli qaror, izohda)
-- Parollar: lokal kanon konteyneri trust (parolsiz). Serverda: CREATE ROLE … PASSWORD '…' (scram-sha-256) — sir .env da, bu faylda EMAS.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vazifalar_migratsiya') THEN CREATE ROLE vazifalar_migratsiya LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vazifalar_api') THEN CREATE ROLE vazifalar_api LOGIN IN ROLE vazifalar_ilova; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vazifalar_hisobot') THEN CREATE ROLE vazifalar_hisobot LOGIN BYPASSRLS; END IF;
END $$;
-- Ulanish limiti: bitta rol butun max_connections'ni egallab olmasin
ALTER ROLE vazifalar_api CONNECTION LIMIT 40;
ALTER ROLE vazifalar_hisobot CONNECTION LIMIT 5;
-- Hisobot roli: uzun so'rov ilovani to'xtatmasin
ALTER ROLE vazifalar_hisobot SET statement_timeout = '30s';
ALTER ROLE vazifalar_hisobot SET default_transaction_read_only = on;

-- Bazaga ulanish: PUBLIC dan olib, aniq rollarga
-- baza nomi qat'iy yozilmaydi (holat boshqa nom bilan qurilishi mumkin — tekshir.sh "tekshiruv" bazasi)
DO $$ BEGIN
  EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO vazifalar_migratsiya, vazifalar_api, vazifalar_hisobot', current_database());
END $$;

-- Sxema: PG 15+ da public sxemaga CREATE PUBLIC'da yo'q (eski versiyalarda bor edi — aniq yozamiz)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO vazifalar_migratsiya;
GRANT USAGE ON SCHEMA public TO vazifalar_hisobot;

-- Hisobot: hamma jadval va view'ni o'qish (yozish yo'q)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO vazifalar_hisobot;

-- Kelajakdagi jadvallar (migratsiyani bajarayotgan rol — CURRENT_USER — yoki migratsiya roli yaratganda) huquqlarni o'zi oladi.
-- KANON XATOSI TUZATILDI (27 holat 65, Testcontainers topdi): avval "FOR ROLE postgres" edi — superuser boshqa nomli serverda (Testcontainers
-- "test", managed DB) migratsiya `role "postgres" does not exist` bilan yiqilardi.
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vazifalar_ilova;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public GRANT USAGE ON SEQUENCES TO vazifalar_ilova;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public GRANT SELECT ON TABLES TO vazifalar_hisobot;
ALTER DEFAULT PRIVILEGES FOR ROLE vazifalar_migratsiya IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vazifalar_ilova;
ALTER DEFAULT PRIVILEGES FOR ROLE vazifalar_migratsiya IN SCHEMA public GRANT USAGE ON SEQUENCES TO vazifalar_ilova;
ALTER DEFAULT PRIVILEGES FOR ROLE vazifalar_migratsiya IN SCHEMA public GRANT SELECT ON TABLES TO vazifalar_hisobot;

-- Funksiyalar: PUBLIC'da EXECUTE sukut bo'yicha bor — qoldiramiz (trigger funksiyalari, uz_normal, joriy_foydalanuvchi kerak)
