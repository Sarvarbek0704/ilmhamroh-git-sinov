-- 117-tashqi-hisoblar.sql — 28-qism #15 (B-119, holat 15): tashqi kimliklar (Google OIDC, #16 da Telegram) — bitta foydalanuvchiga bir nechta kirish usuli.
-- Kalit — (provayder, subyekt): OIDC "sub" (Google'da o'zgarmaydi; email o'zgarishi mumkin — shuning uchun email bilan EMAS, sub bilan topiladi).
CREATE TABLE tashqi_hisoblar (
  id               bigint      GENERATED ALWAYS AS IDENTITY,
  foydalanuvchi_id bigint      NOT NULL,
  provayder        text        NOT NULL,
  subyekt          text        NOT NULL,
  email            text,                     -- bog'langan paytdagi provayder emaili (ma'lumot uchun)
  yaratilgan_vaqt  timestamptz NOT NULL DEFAULT now(),
  oxirgi_kirish    timestamptz,
  CONSTRAINT tashqi_hisoblar_pkey PRIMARY KEY (id),
  CONSTRAINT tashqi_hisoblar_foydalanuvchi_id_fkey FOREIGN KEY (foydalanuvchi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE,
  CONSTRAINT tashqi_hisoblar_provayder_subyekt_key UNIQUE (provayder, subyekt),
  -- bitta foydalanuvchiga har provayderdan bitta hisob
  CONSTRAINT tashqi_hisoblar_foydalanuvchi_provayder_key UNIQUE (foydalanuvchi_id, provayder),
  CONSTRAINT tashqi_hisoblar_provayder_check CHECK (provayder ~ '^[a-z][a-z0-9_-]{1,29}$'),
  CONSTRAINT tashqi_hisoblar_subyekt_check CHECK (char_length(subyekt) BETWEEN 1 AND 255)
);

COMMENT ON TABLE tashqi_hisoblar IS 'Tashqi kirish (#15 OIDC, #16 Telegram): (provayder, subyekt) → foydalanuvchi';
