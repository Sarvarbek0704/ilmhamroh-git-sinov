-- 119-rollar-rls-api.sql — 28-qism #20 (B-124, holat 20): RBAC (rol, bloklash) va RLS'ni API orqali HAQIQATAN yoqish.
-- 27-qismdan beri API superuser bilan ulanardi — 105 RLS siyosatlari chetlab o'tilardi (28 t01 §7–8). Endi ikki pool, ikki rol (eng kam huquq):
--   vazifalar_api  (106, vazifalar_ilova a'zosi) — vazifalar ma'lumoti, RLS ostida: har tranzaksiyada set_config('ilova.foydalanuvchi_id', id, true)
--   vazifalar_auth (yangi)                      — kirish/ro'yxat/sessiya: foydalanuvchilarni email bo'yicha topishi kerak (kim ekanini hali bilmaydi) —
--                                                  shuning uchun foydalanuvchilar'ga o'z siyosati (hammasi), vazifalar'ga HECH qanday huquq yo'q.
-- Parollar — serverda (.env, scram-sha-256), bu faylda emas (lokal kanon — trust).

-- 1) RBAC: rol va bloklash
ALTER TABLE foydalanuvchilar ADD COLUMN rol text NOT NULL DEFAULT 'foydalanuvchi';
ALTER TABLE foydalanuvchilar ADD CONSTRAINT foydalanuvchilar_rol_check CHECK (rol IN ('foydalanuvchi', 'admin'));
ALTER TABLE foydalanuvchilar ADD COLUMN bloklangan_vaqt timestamptz;

-- 2) auth roli
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vazifalar_auth') THEN CREATE ROLE vazifalar_auth LOGIN; END IF;
END $$;
ALTER ROLE vazifalar_auth CONNECTION LIMIT 20;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO vazifalar_auth', current_database()); END $$;
GRANT USAGE ON SCHEMA public TO vazifalar_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON foydalanuvchilar, auth_hodisalar, sessiyalar, bir_martalik_tokenlar, otp_kodlar, tashqi_hisoblar,
  mfa_totp, zaxira_kodlar, passkeylar TO vazifalar_auth;
GRANT USAGE ON SEQUENCE foydalanuvchilar_id_seq, auth_hodisalar_id_seq, sessiyalar_id_seq, bir_martalik_tokenlar_id_seq, otp_kodlar_id_seq,
  tashqi_hisoblar_id_seq, zaxira_kodlar_id_seq, passkeylar_id_seq TO vazifalar_auth;
-- foydalanuvchilar'da RLS yoqiq (105): auth roli uchun alohida siyosat — hamma qator (login email bo'yicha topadi)
CREATE POLICY foydalanuvchilar_auth ON foydalanuvchilar TO vazifalar_auth USING (true) WITH CHECK (true);

-- 3) Ma'lumot roli auth jadvallarini KO'RMASIN (106 default privileges ularni vazifalar_ilova ga avtomatik bergan edi — 28 #20 topilmasi)
REVOKE ALL ON auth_hodisalar, sessiyalar, bir_martalik_tokenlar, otp_kodlar, tashqi_hisoblar, mfa_totp, zaxira_kodlar, passkeylar FROM vazifalar_ilova;

-- 4) PUT /v1/vazifalar (almashtirHammasi) RLS ostida: mijoz bergan id boshqa foydalanuvchiniki bo'lsa — RLS uni yashiradi va INSERT PK bilan
-- to'qnashadi (28 #20 topilmasi: 500). Faqat "shu id'lar band-mi" degan javob — SECURITY DEFINER funksiya (mazmun oshkor bo'lmaydi);
-- sequence holatini o'qish va setval — sequence'ga SELECT/UPDATE.
CREATE FUNCTION vazifa_idlari_band(idlar bigint[]) RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
RETURN (SELECT coalesce(array_agg(id), '{}') FROM vazifalar WHERE id = ANY(idlar));
REVOKE EXECUTE ON FUNCTION vazifa_idlari_band(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vazifa_idlari_band(bigint[]) TO vazifalar_ilova;
GRANT SELECT, UPDATE ON SEQUENCE vazifalar_id_seq TO vazifalar_ilova;

-- 5) Migratsiya holati tekshiruvi (27 holat 40) — Prisma jadvali bo'lsa, API o'qiy olsin
DO $$ BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN GRANT SELECT ON _prisma_migrations TO vazifalar_ilova; END IF;
END $$;

COMMENT ON COLUMN foydalanuvchilar.rol IS 'RBAC (#20): foydalanuvchi | admin';
COMMENT ON FUNCTION vazifa_idlari_band(bigint[]) IS 'RLS ostida PUT: berilgan id''lardan qaysilari band (har qanday egada) — faqat id''lar';
