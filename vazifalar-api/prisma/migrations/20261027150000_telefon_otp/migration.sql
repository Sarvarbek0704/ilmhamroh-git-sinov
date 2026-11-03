-- 115-telefon-otp.sql — 28-qism #13 (B-117, holat 13): telefon raqam va SMS kod (OTP) bilan kirish.
-- Telefon — E.164 (+998XXXXXXXXX), faqat foydalanuvchi o'zi tasdiqlagan raqam (profilda, OTP bilan) — keyin shu raqamga kod bilan kirish mumkin.
-- Kod (6 raqam) bazada OCHIQ EMAS va oddiy sha256 ham EMAS: 10^6 variant — sizib chiqqan hash'ni sekundlarda topish mumkin (t13). HMAC-SHA256(server siri, …).
ALTER TABLE foydalanuvchilar ADD COLUMN telefon text;
ALTER TABLE foydalanuvchilar ADD CONSTRAINT foydalanuvchilar_telefon_check CHECK (telefon ~ '^\+[1-9][0-9]{7,14}$');
-- Bitta raqam — bitta hisob (NULL lar cheklanmaydi)
CREATE UNIQUE INDEX foydalanuvchilar_telefon_key ON foydalanuvchilar (telefon);

CREATE TABLE otp_kodlar (
  id               bigint      GENERATED ALWAYS AS IDENTITY,
  foydalanuvchi_id bigint      NOT NULL,
  maqsad           text        NOT NULL,
  telefon          text        NOT NULL,
  kod_hmac         bytea       NOT NULL,
  yaratilgan_vaqt  timestamptz NOT NULL DEFAULT now(),
  tugash_vaqti     timestamptz NOT NULL,
  urinishlar       int         NOT NULL DEFAULT 0,
  ishlatilgan_vaqt timestamptz,
  ip               inet,
  CONSTRAINT otp_kodlar_pkey PRIMARY KEY (id),
  CONSTRAINT otp_kodlar_foydalanuvchi_id_fkey FOREIGN KEY (foydalanuvchi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE,
  CONSTRAINT otp_kodlar_maqsad_check CHECK (maqsad IN ('kirish', 'telefon_ulash')),
  CONSTRAINT otp_kodlar_telefon_check CHECK (telefon ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT otp_kodlar_kod_hmac_check CHECK (octet_length(kod_hmac) = 32),
  CONSTRAINT otp_kodlar_urinishlar_check CHECK (urinishlar BETWEEN 0 AND 100)
);
-- Oxirgi faol kod va yuborish chastotasi (raqam bo'yicha: soatiga/kuniga) — telefon + vaqt
CREATE INDEX otp_kodlar_telefon_idx ON otp_kodlar (telefon, yaratilgan_vaqt DESC);

COMMENT ON TABLE otp_kodlar IS 'SMS kodlar (#13): kod_hmac = HMAC-SHA256(OTP_SIRI, maqsad:telefon:kod); 5 daqiqa, 5 urinish, bir marta';
