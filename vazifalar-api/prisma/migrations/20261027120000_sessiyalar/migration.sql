-- 112-sessiyalar.sql — 28-qism #07 (B-111, holat 07): server tomonidagi sessiyalar (Postgres sessiya ombori).
-- Brauzer cookie'da faqat tasodifiy token (32 bayt, base64url) saqlaydi; bazada token EMAS, uning SHA-256 hash'i — baza sizib chiqsa ham
-- tokenlar bilan kirib bo'lmaydi (express-session store'i esa sid'ni ochiq kalit qiladi — t07). Token yuqori entropiyali — tuz va sekin hash kerak emas.
-- Muddatlar: oxirgi_faollik — "bo'sh turish" (idle) chegarasi uchun, tugash_vaqti — mutlaq chegara (absolute); bekor_vaqti — chiqish / bekor qilish.
CREATE TABLE sessiyalar (
  id               bigint      GENERATED ALWAYS AS IDENTITY,
  foydalanuvchi_id bigint      NOT NULL,
  token_hash       bytea       NOT NULL,
  yaratilgan_vaqt  timestamptz NOT NULL DEFAULT now(),
  oxirgi_faollik   timestamptz NOT NULL DEFAULT now(),
  tugash_vaqti     timestamptz NOT NULL,
  bekor_vaqti      timestamptz,
  ip               inet,
  user_agent       text,
  CONSTRAINT sessiyalar_pkey PRIMARY KEY (id),
  CONSTRAINT sessiyalar_foydalanuvchi_id_fkey FOREIGN KEY (foydalanuvchi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE,
  CONSTRAINT sessiyalar_token_hash_key UNIQUE (token_hash),
  CONSTRAINT sessiyalar_token_hash_check CHECK (octet_length(token_hash) = 32),
  CONSTRAINT sessiyalar_muddat_check CHECK (tugash_vaqti > yaratilgan_vaqt),
  CONSTRAINT sessiyalar_user_agent_check CHECK (char_length(user_agent) <= 300)
);
-- "barcha qurilmalardan chiqish" va qurilmalar ro'yxati — faqat faol sessiyalar
CREATE INDEX sessiyalar_foydalanuvchi_faol_idx ON sessiyalar (foydalanuvchi_id) WHERE bekor_vaqti IS NULL;

COMMENT ON TABLE sessiyalar IS 'Server sessiyalari (#07): token_hash = sha256(cookie tokeni); idle — oxirgi_faollik, absolute — tugash_vaqti';
