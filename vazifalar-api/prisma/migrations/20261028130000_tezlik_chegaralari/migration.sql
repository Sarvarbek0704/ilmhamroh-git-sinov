-- 122-tezlik-chegaralari.sql — 28-qism #26 (B-129, holat 26): tezlik cheklovi (rate limit) hisoblagichlari — Postgres'da (Redis kanonda ixtiyoriy, 27 holat 65).
-- Fixed window: (kalit, son, tugash) — bitta atomik UPSERT bilan (src/umumiy/cheklov.ts). UNLOGGED: WAL'ga yozilmaydi (tez), server qulasa — hisoblagichlar
-- nolga tushadi (cheklov uchun maqbul yo'qotish). Eski qatorlar — tozalash so'rovi bilan (cheklov.ts, tasodifiy 1 %).
CREATE UNLOGGED TABLE tezlik_chegaralari (
  kalit  text        NOT NULL,
  son    int         NOT NULL,
  tugash timestamptz NOT NULL,
  CONSTRAINT tezlik_chegaralari_pkey PRIMARY KEY (kalit),
  CONSTRAINT tezlik_chegaralari_kalit_check CHECK (char_length(kalit) <= 300)
);
CREATE INDEX tezlik_chegaralari_tugash_idx ON tezlik_chegaralari (tugash);

GRANT SELECT, INSERT, UPDATE, DELETE ON tezlik_chegaralari TO vazifalar_auth;
REVOKE ALL ON tezlik_chegaralari FROM vazifalar_ilova;

COMMENT ON TABLE tezlik_chegaralari IS 'Rate limit (#26): fixed window hisoblagichlari; UNLOGGED';
