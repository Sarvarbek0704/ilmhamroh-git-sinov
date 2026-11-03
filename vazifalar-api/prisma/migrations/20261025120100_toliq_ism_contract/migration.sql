-- 108-toliq-ism-contract.sql — 27-qism #38 (DB-99, holat 38): expand-contract, 3-bosqich (CONTRACT). FAQAT hamma ilova nusxalari toliq_ism'ga
-- o'tgandan keyin (107 dan keyin kamida bitta deploy). Qulflar qisqa: VALIDATE — SHARE UPDATE EXCLUSIVE (yozuvlar o'tadi), SET NOT NULL —
-- PG 12+ validatsiya qilingan CHECK (toliq_ism IS NOT NULL) bo'lsa jadvalni SKANERLAMAYDI, DROP COLUMN — metadata.
-- Har buyruqqa lock_timeout: navbatda turib qolib hamma yozuvni to'smasin (t37 #11–#12); muvaffaqiyatsiz bo'lsa — migratsiya qayta ishga tushiriladi.
-- Prisma migrate deploy migratsiyani tranzaksiyaga O'RAMAYDI (t38 da o'lchandi) — SET LOCAL ta'sirsiz bo'lardi; sessiya darajasida:
SET lock_timeout = '3s';

ALTER TABLE foydalanuvchilar VALIDATE CONSTRAINT foydalanuvchilar_toliq_ism_check;
ALTER TABLE foydalanuvchilar ALTER COLUMN toliq_ism SET NOT NULL;

DROP TRIGGER foydalanuvchilar_ism_sinxron_trg ON foydalanuvchilar;
DROP FUNCTION ism_sinxron();
ALTER TABLE foydalanuvchilar DROP COLUMN ism;              -- ism'ning CHECK cheklovi (foydalanuvchilar_ism_check) ham o'chadi

COMMENT ON COLUMN foydalanuvchilar.toliq_ism IS 'To''liq ism (ism + familiya), 1–100 belgi (foydalanuvchilar_toliq_ism_check)';
