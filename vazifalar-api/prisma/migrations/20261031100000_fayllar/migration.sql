-- 201-fayllar.sql — 29-qism #06 (B-140): fayl metama'lumoti bazada, baytlarning o'zi — S3 (MinIO) da.
-- Ikki jadval:
--   fayllar          — bitta saqlangan obyekt (S3 kaliti, tur, hajm, sha256). Egasi bo'yicha sha256 noyob → bir xil faylni ikki marta
--                      yuklasa, bucket'da bitta nusxa (dublikat aniqlash). Foydalanuvchilararo dedup YO'Q: "bu fayl tizimda bormi?" degan
--                      savolga javob — boshqa odamning fayli haqida ma'lumot sizishi (side channel).
--   vazifa_ilovalari — fayl qaysi vazifaga, qanday nom bilan biriktirilgan (bitta fayl bir nechta vazifada bo'lishi mumkin).
-- Hayot sikli: kutilmoqda (presigned yuklash boshlandi, baytlar hali tasdiqlanmagan) → tayyor (server tekshirdi: hajm, magic bytes, sha256).
-- Yetim (orphan) fayl — hech bir vazifaga biriktirilmagan, 24 soatdan eski → tozalash vazifasi (cron, #48) avval S3 dan, keyin bazadan o'chiradi.
-- Raqamlar 201 dan: 28-qism kanoni 109+ ni ishlatadi (parallel quriladi) — to'qnashmasin.

CREATE TABLE fayllar (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  egasi_id          bigint      NOT NULL,
  kalit             text        NOT NULL,             -- S3 kaliti: fayllar/<egasi>/<uuid>.<kengaytma> — foydalanuvchi nomidan MUSTAQIL
  mime              text        NOT NULL,             -- magic bytes bo'yicha aniqlangan (mijoz aytgani emas)
  hajm              bigint      NOT NULL,
  sha256            bytea,                            -- tasdiqlangunga qadar NULL (presigned yuklashda server baytlarni hali ko'rmagan)
  holat             text        NOT NULL DEFAULT 'kutilmoqda',
  yaratilgan_vaqt   timestamptz NOT NULL DEFAULT now(),
  tasdiqlangan_vaqt timestamptz,
  CONSTRAINT fayllar_pkey PRIMARY KEY (id),
  CONSTRAINT fayllar_egasi_id_fkey FOREIGN KEY (egasi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE,
  CONSTRAINT fayllar_kalit_key UNIQUE (kalit),
  CONSTRAINT fayllar_egasi_id_sha256_key UNIQUE (egasi_id, sha256),   -- NULL'lar teng emas — kutilayotganlar to'qnashmaydi
  CONSTRAINT fayllar_mime_check CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain')),
  CONSTRAINT fayllar_hajm_check CHECK (hajm BETWEEN 1 AND 10485760),  -- 10 MB — API limiti bilan bir xil
  CONSTRAINT fayllar_sha256_check CHECK (octet_length(sha256) = 32),
  CONSTRAINT fayllar_holat_check CHECK (holat IN ('kutilmoqda', 'tayyor')),
  CONSTRAINT fayllar_tayyor_check CHECK ((holat = 'tayyor') = (sha256 IS NOT NULL AND tasdiqlangan_vaqt IS NOT NULL))
);

CREATE TABLE vazifa_ilovalari (
  vazifa_id      bigint      NOT NULL,
  fayl_id        bigint      NOT NULL,
  asl_nom        text        NOT NULL,                -- ko'rsatish va Content-Disposition uchun (tozalangan)
  qoshilgan_vaqt timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vazifa_ilovalari_pkey PRIMARY KEY (vazifa_id, fayl_id),
  CONSTRAINT vazifa_ilovalari_vazifa_id_fkey FOREIGN KEY (vazifa_id) REFERENCES vazifalar (id) ON DELETE CASCADE,
  -- RESTRICT: biriktirilgan faylni bevosita o'chirib bo'lmaydi — avval ilova olinadi, keyin fayl yetim bo'lib tozalanadi
  CONSTRAINT vazifa_ilovalari_fayl_id_fkey FOREIGN KEY (fayl_id) REFERENCES fayllar (id) ON DELETE RESTRICT,
  CONSTRAINT vazifa_ilovalari_asl_nom_check CHECK (char_length(asl_nom) BETWEEN 1 AND 255)
);
CREATE INDEX vazifa_ilovalari_fayl_id_idx ON vazifa_ilovalari (fayl_id);

-- Yetimlarni topish: eski fayllar vaqt bo'yicha, keyin NOT EXISTS (vazifa_ilovalari_fayl_id_idx) — t06 da EXPLAIN
CREATE INDEX fayllar_yaratilgan_vaqt_idx ON fayllar (yaratilgan_vaqt);

-- RLS (105 naqshi): fayl egasi; ilova — vazifa orqali VA fayl ham o'ziniki bo'lishi shart (begona faylni o'z vazifasiga ulab olib bo'lmaydi)
ALTER TABLE fayllar ENABLE ROW LEVEL SECURITY;
ALTER TABLE vazifa_ilovalari ENABLE ROW LEVEL SECURITY;
CREATE POLICY fayllar_egasi ON fayllar TO vazifalar_ilova
  USING (egasi_id = joriy_foydalanuvchi()) WITH CHECK (egasi_id = joriy_foydalanuvchi());
CREATE POLICY vazifa_ilovalari_egasi ON vazifa_ilovalari TO vazifalar_ilova
  USING (EXISTS (SELECT 1 FROM vazifalar v WHERE v.id = vazifa_id))
  WITH CHECK (EXISTS (SELECT 1 FROM vazifalar v WHERE v.id = vazifa_id) AND EXISTS (SELECT 1 FROM fayllar f WHERE f.id = fayl_id));
-- 106 dagi ALTER DEFAULT PRIVILEGES huquqlarni o'zi beradi; aniq yozamiz (holat boshqa rol bilan qurilsa ham)
GRANT SELECT, INSERT, UPDATE, DELETE ON fayllar, vazifa_ilovalari TO vazifalar_ilova;

COMMENT ON TABLE fayllar IS 'S3 dagi obyekt metama''lumoti; baytlar bazada EMAS';
COMMENT ON COLUMN fayllar.kalit IS 'S3 kaliti — tasodifiy (uuid), foydalanuvchi bergan nom emas';
