-- 111-auth-hodisalar.sql — 28-qism #05 (B-109, holat 05): autentifikatsiya hodisalari jurnali (A09 — Security Logging and Alerting).
-- Har ro'yxat, muvaffaqiyatli/muvaffaqiyatsiz kirish, chiqish, parol o'zgarishi — bitta qator. Maqsad: hujumni ko'rish (credential stuffing — bir IP dan
-- ko'p email, brute force — bitta hisobga ko'p urinish), foydalanuvchiga "so'nggi kirishlar" ko'rsatish (#11). Parol, token, kod — HECH QACHON yozilmaydi.
-- Muvaffaqiyatsiz urinishda noma'lum email ham yozilmaydi (shaxsiy ma'lumot) — faqat sabab.
CREATE TABLE auth_hodisalar (
  id               bigint      GENERATED ALWAYS AS IDENTITY,
  foydalanuvchi_id bigint,                     -- noma'lum email bilan urinish — NULL
  tur              text        NOT NULL,
  ip               inet,
  user_agent       text,
  tafsilot         jsonb       NOT NULL DEFAULT '{}',
  vaqt             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_hodisalar_pkey PRIMARY KEY (id),
  CONSTRAINT auth_hodisalar_foydalanuvchi_id_fkey FOREIGN KEY (foydalanuvchi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE,
  CONSTRAINT auth_hodisalar_tur_check CHECK (tur ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT auth_hodisalar_user_agent_check CHECK (char_length(user_agent) <= 300)
);
CREATE INDEX auth_hodisalar_foydalanuvchi_idx ON auth_hodisalar (foydalanuvchi_id, vaqt DESC);
CREATE INDEX auth_hodisalar_ip_idx ON auth_hodisalar (ip, vaqt DESC);

COMMENT ON TABLE auth_hodisalar IS 'Auth jurnali (#05): royxat, kirish, kirish_xato, chiqish … Sir (parol, token, kod) yozilmaydi';
