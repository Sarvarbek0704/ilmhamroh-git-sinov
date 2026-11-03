-- 109-parol.sql — 28-qism #04 (B-108, holat 04): foydalanuvchi paroli — faqat argon2id hash (PHC satri), ochiq parol hech qachon saqlanmaydi.
-- NULL — paroli yo'q hisob (keyin: Google/Telegram/OTP orqali kirganlar, #13–#16). Hash'ni ilova hisoblaydi (src/auth/parol.ts) —
-- pgcrypto crypt() EMAS: parol bazaga ochiq ketmasin (so'rov logi, pg_stat_statements, xato xabari).
ALTER TABLE foydalanuvchilar ADD COLUMN parol_hash text;

-- Faqat PHC satri ko'rinishida ($argon2id$v=19$m=…,t=…,p=…$tuz$hash). Ochiq parol tasodifan yozilsa — baza rad etadi
ALTER TABLE foydalanuvchilar ADD CONSTRAINT foydalanuvchilar_parol_hash_check
  CHECK (parol_hash IS NULL OR parol_hash ~ '^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$');

COMMENT ON COLUMN foydalanuvchilar.parol_hash IS 'argon2id PHC satri (src/auth/parol.ts); NULL — parolsiz hisob';
