-- 303-embeddinglar.sql — 31-qism #08 (DB-130 pgvector) va #17 (B-208 semantik qidiruv): vazifa matnining embedding'i.
-- Alohida jadval (vazifalar'ga ustun EMAS): model yoki o'lcham almashsa — jadval qayta to'ldiriladi, asosiy jadval yozuvlari og'irlashmaydi; matn_hash —
-- matn o'zgargan-o'zgarmaganini bilish (faqat o'zgarganlar qayta hisoblanadi). Kengaytma: pgvector (`pgvector/pgvector:pg18` image'da; managed
-- Postgres'da — provayder ro'yxatidan yoqiladi). CREATE EXTENSION — superuser/egasi huquqi: migratsiya roli bilan, API roli bilan EMAS.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE vazifa_embeddinglar (
  vazifa_id        bigint      NOT NULL,
  egasi_id         bigint      NOT NULL,
  model            text        NOT NULL,
  matn_hash        bytea       NOT NULL,              -- sha256(matn): o'zgarmagan bo'lsa qayta so'ralmaydi (pul va limit)
  embedding        vector(768) NOT NULL,              -- AI_EMBEDDING: gemini-embedding-2, outputDimensionality 768, normallashtirilgan
  yangilangan_vaqt timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vazifa_embeddinglar_pkey PRIMARY KEY (vazifa_id),
  CONSTRAINT vazifa_embeddinglar_vazifa_id_fkey FOREIGN KEY (vazifa_id) REFERENCES vazifalar (id) ON DELETE CASCADE,
  CONSTRAINT vazifa_embeddinglar_egasi_id_fkey FOREIGN KEY (egasi_id) REFERENCES foydalanuvchilar (id) ON DELETE CASCADE
);
-- HNSW (t08 o'lchovi: IVFFlat bilan solishtirish) — cosine masofa (`<=>`); vektorlar normallashtirilgan — inner product (`<#>`) ham bir xil tartib beradi
CREATE INDEX vazifa_embeddinglar_hnsw ON vazifa_embeddinglar USING hnsw (embedding vector_cosine_ops);
CREATE INDEX vazifa_embeddinglar_egasi_id_idx ON vazifa_embeddinglar (egasi_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON vazifa_embeddinglar TO vazifalar_ilova;
ALTER TABLE vazifa_embeddinglar ENABLE ROW LEVEL SECURITY;
CREATE POLICY vazifa_embeddinglar_egasi ON vazifa_embeddinglar TO vazifalar_ilova
  USING (egasi_id = joriy_foydalanuvchi()) WITH CHECK (egasi_id = joriy_foydalanuvchi());

COMMENT ON TABLE vazifa_embeddinglar IS '31 #08/#17: vazifa embeddinglari (pgvector, HNSW cosine) — semantik qidiruv va RAG (#18)';
