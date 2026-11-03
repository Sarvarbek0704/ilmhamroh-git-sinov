-- 306-bayroqlar.sql — 31-qism #25 (B-216): feature flag'lar — kodni chiqarish (deploy) va xususiyatni yoqish ALOHIDA.
-- Baholash (ilova, src/bayroq/bayroqlar.ts): yoqilgan=false — hammaga o'chiq (kill switch); foydalanuvchilar ro'yxatida — yoqiq; rollar segmentida — yoqiq;
-- aks holda foizli rollout: sha256(kalit:foydalanuvchi_id) → 0..99 < foiz (deterministik: bir foydalanuvchi har safar bir xil natija; foiz oshsa — eski "yoqiq"lar qoladi).
CREATE TABLE bayroqlar (
  kalit            text        NOT NULL,
  yoqilgan         boolean     NOT NULL DEFAULT false,
  foiz             smallint    NOT NULL DEFAULT 0,
  rollar           text[]      NOT NULL DEFAULT '{}',
  foydalanuvchilar bigint[]    NOT NULL DEFAULT '{}',
  tavsif           text,
  yangilangan_vaqt timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bayroqlar_pkey PRIMARY KEY (kalit),
  CONSTRAINT bayroqlar_kalit_check CHECK (kalit ~ '^[a-z][a-z0-9-]{1,49}$'),
  CONSTRAINT bayroqlar_foiz_check CHECK (foiz BETWEEN 0 AND 100)
);
-- boshlang'ich bayroqlar: AI xususiyatlari yoqiq (100 %); rollout — admin yo'li bilan (PUT /v1/admin/bayroqlar/:kalit)
INSERT INTO bayroqlar (kalit, yoqilgan, foiz, rollar, tavsif) VALUES
  ('ai-qadamlar', true, 100, '{}', 'POST /v1/vazifalar/:id/qadamlar'),
  ('ai-yordamchi', true, 100, '{}', 'GET /v1/qidiruv, POST /v1/yordamchi/savol');

GRANT SELECT ON bayroqlar TO vazifalar_ilova;
GRANT SELECT, INSERT, UPDATE ON bayroqlar TO vazifalar_auth;   -- admin yo'li (auth pool)

COMMENT ON TABLE bayroqlar IS '31 #25: feature flag''lar — kill switch, ruxsat ro''yxati, rol segmenti, deterministik foizli rollout';
