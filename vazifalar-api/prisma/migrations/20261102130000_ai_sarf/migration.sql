-- 304-ai-sarf.sql — 31-qism #19 (B-210): AI xarajati — foydalanuvchi kunlik kvotasi (so'rovlar va tokenlar). Kun — APP_TZ (ilova) bo'yicha, kod beradi.
-- Bitta qator = (foydalanuvchi, kun): band qilish — atomik `INSERT … ON CONFLICT DO UPDATE … WHERE chegara` (parallel so'rovlar chegaradan oshmaydi).
CREATE TABLE ai_sarf (
  foydalanuvchi_id bigint  NOT NULL,
  kun              date    NOT NULL,
  sorovlar         integer NOT NULL DEFAULT 0,
  tokenlar         integer NOT NULL DEFAULT 0,
  CONSTRAINT ai_sarf_pkey PRIMARY KEY (foydalanuvchi_id, kun),
  CONSTRAINT ai_sarf_foydalanuvchi_id_fkey FOREIGN KEY (foydalanuvchi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE,
  CONSTRAINT ai_sarf_sorovlar_check CHECK (sorovlar >= 0 AND tokenlar >= 0)
);

GRANT SELECT, INSERT, UPDATE ON ai_sarf TO vazifalar_ilova;
ALTER TABLE ai_sarf ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_sarf_egasi ON ai_sarf TO vazifalar_ilova
  USING (foydalanuvchi_id = joriy_foydalanuvchi()) WITH CHECK (foydalanuvchi_id = joriy_foydalanuvchi());

COMMENT ON TABLE ai_sarf IS '31 #19: AI kunlik kvotasi — so''rovlar (LLM chaqiruvidan oldin band qilinadi) va tokenlar (javobdan keyin qo''shiladi)';
