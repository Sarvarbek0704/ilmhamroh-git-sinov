-- 118-mfa-passkey.sql — 28-qism #19 (B-123, holat 19): ikki faktorli autentifikatsiya (TOTP + zaxira kodlar) va passkeys (WebAuthn).
-- TOTP siri — bazada SHIFRLANGAN (AES-256-GCM, kalit ILOVA_SIRI dan HKDF): siri sizsa, hujumchi istalgan payt kod hosil qiladi — parol hash'idan farqli,
-- uni hash qilib bo'lmaydi (server kodni hisoblashi uchun sirning o'zi kerak). Zaxira kodlar — HMAC (bir martalik), passkey — faqat OCHIQ kalit.
CREATE TABLE mfa_totp (
  foydalanuvchi_id bigint      NOT NULL,
  siri_shifr       bytea       NOT NULL,                 -- iv(12) + teg(16) + shifrlangan siri
  yoqilgan_vaqt    timestamptz,                          -- NULL — sozlanmoqda (birinchi kod hali tasdiqlanmagan)
  oxirgi_qadam     bigint      NOT NULL DEFAULT 0,       -- oxirgi qabul qilingan 30 s qadami — bitta kodni ikki marta ishlatib bo'lmaydi
  yaratilgan_vaqt  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mfa_totp_pkey PRIMARY KEY (foydalanuvchi_id),
  CONSTRAINT mfa_totp_foydalanuvchi_id_fkey FOREIGN KEY (foydalanuvchi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE
);

CREATE TABLE zaxira_kodlar (
  id               bigint      GENERATED ALWAYS AS IDENTITY,
  foydalanuvchi_id bigint      NOT NULL,
  kod_hmac         bytea       NOT NULL,
  ishlatilgan_vaqt timestamptz,
  CONSTRAINT zaxira_kodlar_pkey PRIMARY KEY (id),
  CONSTRAINT zaxira_kodlar_foydalanuvchi_id_fkey FOREIGN KEY (foydalanuvchi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE,
  CONSTRAINT zaxira_kodlar_kod_hmac_key UNIQUE (kod_hmac)
);
CREATE INDEX zaxira_kodlar_foydalanuvchi_idx ON zaxira_kodlar (foydalanuvchi_id);

CREATE TABLE passkeylar (
  id               bigint      GENERATED ALWAYS AS IDENTITY,
  foydalanuvchi_id bigint      NOT NULL,
  credential_id    text        NOT NULL,                 -- base64url, autentifikator beradi
  ochiq_kalit      bytea       NOT NULL,                 -- COSE ochiq kalit
  hisoblagich      bigint      NOT NULL DEFAULT 0,       -- signCount — klonlangan autentifikatorni aniqlash uchun
  transports       text[]      NOT NULL DEFAULT '{}',
  nom              text        NOT NULL DEFAULT 'Passkey',
  yaratilgan_vaqt  timestamptz NOT NULL DEFAULT now(),
  oxirgi_ishlatish timestamptz,
  CONSTRAINT passkeylar_pkey PRIMARY KEY (id),
  CONSTRAINT passkeylar_foydalanuvchi_id_fkey FOREIGN KEY (foydalanuvchi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE,
  CONSTRAINT passkeylar_credential_id_key UNIQUE (credential_id),
  CONSTRAINT passkeylar_nom_check CHECK (char_length(nom) BETWEEN 1 AND 60)
);
CREATE INDEX passkeylar_foydalanuvchi_idx ON passkeylar (foydalanuvchi_id);

COMMENT ON TABLE mfa_totp IS 'TOTP (RFC 6238, #19): siri AES-256-GCM bilan shifrlangan; oxirgi_qadam — qayta ishlatishdan himoya';
COMMENT ON TABLE passkeylar IS 'WebAuthn passkeys (#19): faqat ochiq kalit va hisoblagich';
