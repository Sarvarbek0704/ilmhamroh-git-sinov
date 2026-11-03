-- 121-api-kalitlar.sql — 28-qism #22 (B-126, holat 22): API kalitlari — dastur (skript, CLI, integratsiya) foydalanuvchi nomidan so'rov yuboradi.
-- Kalit: vz_<prefiks 8>_<sir 43> — to'liq kalit FAQAT yaratilganda bir marta ko'rsatiladi; bazada prefiks (qidirish uchun, ochiq) va sirning HMAC'i.
-- Kalit yuqori entropiyali (256 bit) — argon2 kerak emas (parol emas), HMAC(ILOVA_SIRI → HKDF "api-kalit") — baza sizsa ham tekshirib bo'lmaydi.
CREATE TABLE api_kalitlar (
  id               bigint      GENERATED ALWAYS AS IDENTITY,
  foydalanuvchi_id bigint      NOT NULL,
  prefiks          text        NOT NULL,
  kalit_hmac       bytea       NOT NULL,
  nom              text        NOT NULL,
  ruxsatlar        text[]      NOT NULL,
  yaratilgan_vaqt  timestamptz NOT NULL DEFAULT now(),
  tugash_vaqti     timestamptz,                -- NULL — muddatsiz (tavsiya etilmaydi); aylantirishda eskisiga qisqa muddat qo'yiladi
  oxirgi_ishlatish timestamptz,
  bekor_vaqti      timestamptz,
  CONSTRAINT api_kalitlar_pkey PRIMARY KEY (id),
  CONSTRAINT api_kalitlar_foydalanuvchi_id_fkey FOREIGN KEY (foydalanuvchi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE,
  CONSTRAINT api_kalitlar_prefiks_key UNIQUE (prefiks),
  CONSTRAINT api_kalitlar_prefiks_check CHECK (prefiks ~ '^[a-z0-9]{8}$'),
  CONSTRAINT api_kalitlar_kalit_hmac_check CHECK (octet_length(kalit_hmac) = 32),
  CONSTRAINT api_kalitlar_nom_check CHECK (char_length(nom) BETWEEN 1 AND 60),
  CONSTRAINT api_kalitlar_ruxsatlar_check CHECK (cardinality(ruxsatlar) > 0 AND ruxsatlar <@ ARRAY['vazifalar:oqish', 'vazifalar:yozish'])
);
CREATE INDEX api_kalitlar_foydalanuvchi_idx ON api_kalitlar (foydalanuvchi_id);

-- Faqat auth roli (119 qoidasi): ma'lumot roli kalitlarni ko'rmaydi
GRANT SELECT, INSERT, UPDATE, DELETE ON api_kalitlar TO vazifalar_auth;
GRANT USAGE ON SEQUENCE api_kalitlar_id_seq TO vazifalar_auth;
REVOKE ALL ON api_kalitlar FROM vazifalar_ilova;

COMMENT ON TABLE api_kalitlar IS 'API kalitlari (#22): vz_<prefiks>_<sir>; kalit_hmac = HMAC(api-kalit kaliti, sir); ruxsatlar — scope';
