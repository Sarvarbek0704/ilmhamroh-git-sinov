-- 204-outbox.sql — 29-qism #50 (B-184, AR-25): transactional outbox — domen hodisasi vazifa o'zgarishi bilan BIR tranzaksiyada yoziladi,
-- relay (polling, FOR UPDATE SKIP LOCKED) uni navbatga/SSE/webhook'ga tarqatadi. "Bazaga yozdim, lekin navbatga qo'yolmadim" (dual write) muammosi yo'qoladi.
-- Kafolat: at-least-once (relay yuborib, belgilashdan oldin o'lsa — qayta yuboradi) → iste'molchilar idempotent (hodisa_id bo'yicha).
-- Trigger EMAS, ilova yozadi: hodisa nomi va ma'lumoti — biznes ma'nosi (vazifa.bajarildi), qator o'zgarishi emas (CDC — Debezium — awareness).

CREATE TABLE outbox (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hodisa_id       uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tur             text        NOT NULL,
  foydalanuvchi_id bigint     NOT NULL,
  malumot         jsonb       NOT NULL,
  yaratilgan_vaqt timestamptz NOT NULL DEFAULT now(),
  tarqatilgan_vaqt timestamptz,
  urinishlar      int         NOT NULL DEFAULT 0
);
-- Faqat tarqatilmaganlar — relay so'rovi uchun kichik qisman indeks (tarqatilganlar ko'payib ketsa ham tez)
CREATE INDEX outbox_navbat_idx ON outbox (id) WHERE tarqatilgan_vaqt IS NULL;

-- Ilova roli yoza oladi (vazifa bilan birga), o'qish/belgilash — relay (alohida jarayon, ilova roli emas)
GRANT INSERT ON outbox TO vazifalar_ilova;
GRANT USAGE ON SEQUENCE outbox_id_seq TO vazifalar_ilova;
REVOKE SELECT, UPDATE, DELETE ON outbox FROM vazifalar_ilova;
