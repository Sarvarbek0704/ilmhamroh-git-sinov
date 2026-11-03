-- 114-email-tasdiq-tokenlar.sql — 28-qism #12 (B-116, holat 12): email tasdiqlash va parol tiklash — bir martalik tokenlar.
-- Token (32 bayt, CSPRNG) faqat xatda (havolaning # qismida — server loglari va Referer'ga tushmaydi); bazada sha256. Har token: maqsad, muddat, bir marta ishlatiladi.
ALTER TABLE foydalanuvchilar ADD COLUMN email_tasdiqlangan_vaqt timestamptz;
-- Mavjud hisoblar (114 dan oldin ro'yxatdan o'tgan) — tasdiqlangan deb hisoblanadi (aks holda ular kira olmay qoladi). Ongli qaror — QADAMLAR #12, bosh muharrir.
UPDATE foydalanuvchilar SET email_tasdiqlangan_vaqt = yaratilgan_vaqt WHERE email_tasdiqlangan_vaqt IS NULL;

CREATE TABLE bir_martalik_tokenlar (
  id               bigint      GENERATED ALWAYS AS IDENTITY,
  foydalanuvchi_id bigint      NOT NULL,
  maqsad           text        NOT NULL,
  token_hash       bytea       NOT NULL,
  yaratilgan_vaqt  timestamptz NOT NULL DEFAULT now(),
  tugash_vaqti     timestamptz NOT NULL,
  ishlatilgan_vaqt timestamptz,
  ip               inet,
  CONSTRAINT bir_martalik_tokenlar_pkey PRIMARY KEY (id),
  CONSTRAINT bir_martalik_tokenlar_foydalanuvchi_id_fkey FOREIGN KEY (foydalanuvchi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE,
  CONSTRAINT bir_martalik_tokenlar_token_hash_key UNIQUE (token_hash),
  CONSTRAINT bir_martalik_tokenlar_maqsad_check CHECK (maqsad IN ('email_tasdiq', 'parol_tiklash')),
  CONSTRAINT bir_martalik_tokenlar_token_hash_check CHECK (octet_length(token_hash) = 32),
  CONSTRAINT bir_martalik_tokenlar_muddat_check CHECK (tugash_vaqti > yaratilgan_vaqt)
);
-- "oxirgi yuborilgan" (qayta yuborish oralig'i) va "eskilarini bekor qilish" — foydalanuvchi + maqsad bo'yicha
CREATE INDEX bir_martalik_tokenlar_foydalanuvchi_idx ON bir_martalik_tokenlar (foydalanuvchi_id, maqsad, yaratilgan_vaqt DESC);

COMMENT ON TABLE bir_martalik_tokenlar IS 'Email tasdiqlash / parol tiklash (#12): token_hash = sha256(token), bir marta, muddatli';
