-- 202-bildirishnomalar.sql — 29-qism #18 (B-152, AR-44): bildirishnoma tizimi — bitta hodisa, bir nechta kanal.
--   bildirishnomalar — ilova ichidagi (in-app) xabar ham, kanallarga yuborishning manbasi ham. dedup_kalit — bir hodisa ikki marta
--                      bildirilmasin (masalan "vazifa:42:muddat:2026-10-28" — cron qayta ishlasa ham bitta yozuv).
--   yetkazishlar     — har kanal (email, telegram, push, sms) uchun alohida holat va urinishlar — qaysi kanal muvaffaqiyatsiz bo'lganini ko'rish uchun.
--   telegram_ulanishlar, push_obunalar — foydalanuvchining kanal manzillari. Email — foydalanuvchilar.email (tasdiqlangani 28-qismda).
-- Afzalliklar — foydalanuvchilar.sozlamalar->'bildirishnoma' (101): {"email": bool, "telegram": bool, "push": bool}; kalit yo'q → sukut (kanal turiga qarab).

CREATE TABLE bildirishnomalar (
  id              bigint      GENERATED ALWAYS AS IDENTITY,
  foydalanuvchi_id bigint     NOT NULL,
  tur             text        NOT NULL,              -- 'vazifa.muddat', 'vazifa.izoh', 'tizim' …
  sarlavha        text        NOT NULL,
  matn            text        NOT NULL,
  havola          text,                              -- ilova ichidagi yo'l (/vazifalar/42), tashqi URL emas
  dedup_kalit     text,
  oqilgan_vaqt    timestamptz,
  yaratilgan_vaqt timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bildirishnomalar_pkey PRIMARY KEY (id),
  CONSTRAINT bildirishnomalar_foydalanuvchi_id_fkey FOREIGN KEY (foydalanuvchi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE,
  CONSTRAINT bildirishnomalar_dedup_kalit_key UNIQUE (foydalanuvchi_id, dedup_kalit),
  CONSTRAINT bildirishnomalar_tur_check CHECK (tur ~ '^[a-z]+(\.[a-z_]+)*$'),
  CONSTRAINT bildirishnomalar_sarlavha_check CHECK (char_length(sarlavha) BETWEEN 1 AND 120),
  CONSTRAINT bildirishnomalar_matn_check CHECK (char_length(matn) BETWEEN 1 AND 1000),
  CONSTRAINT bildirishnomalar_havola_check CHECK (havola IS NULL OR havola ~ '^/[^/]')   -- faqat ichki yo'l (open redirect yo'q)
);
-- "O'qilmaganlar soni" va ro'yxat — eng ko'p so'rov
CREATE INDEX bildirishnomalar_royxat_idx ON bildirishnomalar (foydalanuvchi_id, yaratilgan_vaqt DESC, id DESC);
CREATE INDEX bildirishnomalar_oqilmagan_idx ON bildirishnomalar (foydalanuvchi_id) WHERE oqilgan_vaqt IS NULL;

CREATE TABLE yetkazishlar (
  bildirishnoma_id bigint     NOT NULL,
  kanal           text        NOT NULL,
  holat           text        NOT NULL DEFAULT 'navbatda',
  urinishlar      int         NOT NULL DEFAULT 0,
  oxirgi_xato     text,
  yangilangan_vaqt timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT yetkazishlar_pkey PRIMARY KEY (bildirishnoma_id, kanal),
  CONSTRAINT yetkazishlar_bildirishnoma_id_fkey FOREIGN KEY (bildirishnoma_id) REFERENCES bildirishnomalar (id) ON DELETE CASCADE,
  CONSTRAINT yetkazishlar_kanal_check CHECK (kanal IN ('email', 'telegram', 'push', 'sms')),
  CONSTRAINT yetkazishlar_holat_check CHECK (holat IN ('navbatda', 'yuborildi', 'xato', 'otkazildi'))   -- otkazildi: limit/afzallik
);
-- Rate limit: "oxirgi soatda shu foydalanuvchiga nechta email ketdi"
CREATE INDEX yetkazishlar_vaqt_idx ON yetkazishlar (kanal, yangilangan_vaqt) WHERE holat = 'yuborildi';

CREATE TABLE telegram_ulanishlar (
  foydalanuvchi_id bigint     NOT NULL,
  chat_id         bigint      NOT NULL,              -- Telegram ID'lari 52 bitgacha — int emas, bigint
  faol            boolean     NOT NULL DEFAULT true,  -- 403 (bot bloklangan) → false
  ulangan_vaqt    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_ulanishlar_pkey PRIMARY KEY (foydalanuvchi_id),
  CONSTRAINT telegram_ulanishlar_chat_id_key UNIQUE (chat_id),
  CONSTRAINT telegram_ulanishlar_foydalanuvchi_id_fkey FOREIGN KEY (foydalanuvchi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE
);

CREATE TABLE push_obunalar (
  id              bigint      GENERATED ALWAYS AS IDENTITY,
  foydalanuvchi_id bigint     NOT NULL,
  endpoint        text        NOT NULL,
  p256dh          text        NOT NULL,
  auth            text        NOT NULL,
  yaratilgan_vaqt timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_obunalar_pkey PRIMARY KEY (id),
  CONSTRAINT push_obunalar_endpoint_key UNIQUE (endpoint),          -- bir brauzer — bir obuna; qayta obuna → upsert
  CONSTRAINT push_obunalar_foydalanuvchi_id_fkey FOREIGN KEY (foydalanuvchi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE,
  CONSTRAINT push_obunalar_endpoint_check CHECK (endpoint ~ '^https://')
);
CREATE INDEX push_obunalar_foydalanuvchi_id_idx ON push_obunalar (foydalanuvchi_id);

-- RLS (105 naqshi): foydalanuvchi faqat o'zinikini; yetkazishlar — ilova roli faqat o'qiydi (yozuvchi — worker, alohida rol bilan)
ALTER TABLE bildirishnomalar ENABLE ROW LEVEL SECURITY;
ALTER TABLE yetkazishlar ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_ulanishlar ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_obunalar ENABLE ROW LEVEL SECURITY;
CREATE POLICY bildirishnomalar_egasi ON bildirishnomalar TO vazifalar_ilova
  USING (foydalanuvchi_id = joriy_foydalanuvchi()) WITH CHECK (foydalanuvchi_id = joriy_foydalanuvchi());
CREATE POLICY yetkazishlar_egasi ON yetkazishlar FOR SELECT TO vazifalar_ilova
  USING (EXISTS (SELECT 1 FROM bildirishnomalar b WHERE b.id = bildirishnoma_id));
CREATE POLICY telegram_ulanishlar_egasi ON telegram_ulanishlar TO vazifalar_ilova
  USING (foydalanuvchi_id = joriy_foydalanuvchi()) WITH CHECK (foydalanuvchi_id = joriy_foydalanuvchi());
CREATE POLICY push_obunalar_egasi ON push_obunalar TO vazifalar_ilova
  USING (foydalanuvchi_id = joriy_foydalanuvchi()) WITH CHECK (foydalanuvchi_id = joriy_foydalanuvchi());
GRANT SELECT, INSERT, UPDATE, DELETE ON bildirishnomalar, telegram_ulanishlar, push_obunalar TO vazifalar_ilova;
GRANT SELECT ON yetkazishlar TO vazifalar_ilova;
REVOKE INSERT, UPDATE, DELETE ON yetkazishlar FROM vazifalar_ilova;   -- 106 dagi DEFAULT PRIVILEGES bergan huquqni qaytarib olamiz
