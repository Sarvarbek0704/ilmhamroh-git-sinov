-- 203-webhooklar.sql — 29-qism #35 (B-169): chiquvchi webhook'lar — foydalanuvchi o'z URL'ini ro'yxatdan o'tkazadi, vazifa hodisalari imzolanib yuboriladi.
-- 25-qismdagi `WEBHOOK_URL` (bitta, global, fire-and-forget) o'rnini bosadi: har foydalanuvchiga alohida obuna, sir, yetkazish jurnali, qayta urinish, DLQ.
--   webhook_obunalari   — URL, sir (HMAC kaliti — Standard Webhooks `whsec_` formati), qaysi hodisalar; 410 Gone yoki ko'p xato → faolsiz.
--   webhook_yetkazishlar — har (obuna, hodisa) uchun bitta qator: holat, urinishlar, keyingi urinish vaqti, oxirgi HTTP status/xato. 'tashlandi' — DLQ.

CREATE TABLE webhook_obunalari (
  id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  foydalanuvchi_id bigint      NOT NULL REFERENCES foydalanuvchilar (id) ON DELETE CASCADE,
  url              text        NOT NULL CHECK (url ~ '^https?://' AND char_length(url) <= 2000),
  sir              text        NOT NULL,                     -- whsec_<base64>; foydalanuvchiga bir marta ko'rsatiladi
  hodisalar        text[]      NOT NULL DEFAULT '{vazifa.yaratildi,vazifa.yangilandi,vazifa.bajarildi,vazifa.ochirildi}',
  faol             boolean     NOT NULL DEFAULT true,
  ketma_ket_xato   int         NOT NULL DEFAULT 0,
  yaratilgan_vaqt  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_obunalari_foydalanuvchi_idx ON webhook_obunalari (foydalanuvchi_id) WHERE faol;

CREATE TABLE webhook_yetkazishlar (
  id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  obuna_id         bigint      NOT NULL REFERENCES webhook_obunalari (id) ON DELETE CASCADE,
  hodisa_id        text        NOT NULL,                     -- `webhook-id` sarlavhasi: qabul qiluvchi shu bo'yicha takrorni tashlaydi
  tur              text        NOT NULL,
  tana             jsonb       NOT NULL,
  holat            text        NOT NULL DEFAULT 'navbatda' CHECK (holat IN ('navbatda', 'yuborilmoqda', 'yuborildi', 'tashlandi')),
  urinishlar       int         NOT NULL DEFAULT 0,
  keyingi_urinish  timestamptz NOT NULL DEFAULT now(),
  oxirgi_status    int,
  oxirgi_xato      text,
  yaratilgan_vaqt  timestamptz NOT NULL DEFAULT now(),
  yuborilgan_vaqt  timestamptz,
  CONSTRAINT webhook_yetkazishlar_hodisa_key UNIQUE (obuna_id, hodisa_id)
);
CREATE INDEX webhook_yetkazishlar_navbat_idx ON webhook_yetkazishlar (keyingi_urinish) WHERE holat = 'navbatda';

ALTER TABLE webhook_obunalari ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_yetkazishlar ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_obunalari_egasi ON webhook_obunalari TO vazifalar_ilova
  USING (foydalanuvchi_id = joriy_foydalanuvchi()) WITH CHECK (foydalanuvchi_id = joriy_foydalanuvchi());
CREATE POLICY webhook_yetkazishlar_egasi ON webhook_yetkazishlar FOR SELECT TO vazifalar_ilova
  USING (EXISTS (SELECT 1 FROM webhook_obunalari o WHERE o.id = obuna_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_obunalari TO vazifalar_ilova;
GRANT SELECT ON webhook_yetkazishlar TO vazifalar_ilova;
REVOKE INSERT, UPDATE, DELETE ON webhook_yetkazishlar FROM vazifalar_ilova;
