-- 107-toliq-ism-expand.sql — 27-qism #38 (DB-99, holat 38): ustun nomini o'zgartirish ZERO-DOWNTIME — expand-contract, 1-bosqich (EXPAND).
-- Maqsad: foydalanuvchilar.ism → toliq_ism (ism + familiya bitta ustunda — 28-qism profil sahifasi "To'liq ism" deydi).
-- `ALTER TABLE … RENAME COLUMN` bir zumda, LEKIN eski kod (ism'ni o'qiydi/yozadi) bilan yangi kod bir vaqtda ishlaydi (rolling deploy) —
-- rename eski kodni darhol sindiradi. Shuning uchun: (1) EXPAND — yangi ustun + ikki tomonlama sinxron trigger + backfill (eski va yangi kod
-- birga ishlaydi); (2) ilova yangi ustunga o'tadi (deploy); (3) CONTRACT (108) — eski ustun o'chiriladi.
-- Prisma Migrate ekvivalenti: prisma/migrations/20261025120000_toliq_ism_expand (bir xil SQL).

ALTER TABLE foydalanuvchilar ADD COLUMN toliq_ism text;   -- metadata o'zgarishi (default'siz) — bir zumda (t37: 14 ms)

-- Ikki tomonlama sinxron: eski kod ism'ni yozsa → toliq_ism; yangi kod toliq_ism'ni yozsa → ism (ism hali NOT NULL)
CREATE FUNCTION ism_sinxron() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.toliq_ism := coalesce(NEW.toliq_ism, NEW.ism);
    NEW.ism := coalesce(NEW.ism, NEW.toliq_ism);
  ELSIF NEW.ism IS DISTINCT FROM OLD.ism THEN
    NEW.toliq_ism := NEW.ism;
  ELSIF NEW.toliq_ism IS DISTINCT FROM OLD.toliq_ism THEN
    NEW.ism := NEW.toliq_ism;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER foydalanuvchilar_ism_sinxron_trg BEFORE INSERT OR UPDATE OF ism, toliq_ism ON foydalanuvchilar
FOR EACH ROW EXECUTE FUNCTION ism_sinxron();

-- Backfill. Katta jadvalda BITTA UPDATE — uzun tranzaksiya va hamma qatorga qulf; partiyalab (har 5 000) alohida tranzaksiyalarda qilinadi
-- (natijalar/tajriba/t38-expand-contract.txt). Bu jadval kichik (foydalanuvchilar) — bitta buyruq.
UPDATE foydalanuvchilar SET toliq_ism = ism WHERE toliq_ism IS NULL;

-- Cheklov — NOT VALID (eski qatorlarni skanerlamaydi, faqat yangi yozuvlar); VALIDATE va NOT NULL — CONTRACT bosqichida (108)
ALTER TABLE foydalanuvchilar ADD CONSTRAINT foydalanuvchilar_toliq_ism_check
  CHECK (toliq_ism IS NOT NULL AND btrim(toliq_ism) <> '' AND char_length(toliq_ism) <= 100) NOT VALID;

COMMENT ON COLUMN foydalanuvchilar.toliq_ism IS 'To''liq ism (ism + familiya). 107 — expand: ism bilan trigger orqali sinxron; 108 — ism o''chiriladi';
