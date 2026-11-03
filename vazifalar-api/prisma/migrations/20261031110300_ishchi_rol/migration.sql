-- 205-ishchi-rol.sql — 29-qism B (holat 18): fon jarayonlari roli. API (vazifalar_api) RLS ostida, bitta foydalanuvchi nomidan ishlaydi; worker,
-- relay va bot esa HAMMA foydalanuvchi qatorlari bilan ishlaydi (eslatma, yetkazish, outbox tarqatish, yetim fayllar). Ularga vazifalar_api ni
-- BYPASSRLS qilish — API'dagi bitta IDOR butun bazani ochadi. Shuning uchun alohida rol: vazifalar_ishchi (LOGIN, BYPASSRLS), faqat kerakli jadvallar.
-- Auth jadvallariga (sessiyalar, parollar, tokenlar) huquq YO'Q. Parol — serverda (.env, scram-sha-256), bu faylda emas (lokal kanon — trust).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vazifalar_ishchi') THEN CREATE ROLE vazifalar_ishchi LOGIN BYPASSRLS; END IF;
END $$;
ALTER ROLE vazifalar_ishchi CONNECTION LIMIT 20;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO vazifalar_ishchi', current_database()); END $$;
GRANT USAGE ON SCHEMA public TO vazifalar_ishchi;

-- O'qish: kimga va nima (email, til, afzalliklar — sozlamalar; vazifa matni va muddati)
GRANT SELECT ON foydalanuvchilar, vazifalar TO vazifalar_ishchi;
-- Bildirishnoma kanallari: yetkazish holati, eskirgan manzilni faolsizlash/o'chirish, bot /start da ulanish
GRANT SELECT, INSERT, UPDATE, DELETE ON bildirishnomalar, yetkazishlar, telegram_ulanishlar, push_obunalar TO vazifalar_ishchi;
-- Fayllar: yetim fayllarni tozalash, rasm ko'rinishlari
GRANT SELECT, UPDATE, DELETE ON fayllar, vazifa_ilovalari TO vazifalar_ishchi;
-- Webhook yetkazishlari va outbox relay
GRANT SELECT, UPDATE ON webhook_obunalari TO vazifalar_ishchi;
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_yetkazishlar, outbox TO vazifalar_ishchi;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO vazifalar_ishchi;

-- SMS yetkazish callback'i (API jarayoni qabul qiladi): API roli yetkazishlar'ga yoza olmaydi (202 REVOKE) — huquqni kengaytirish o'rniga
-- bitta tor amal: faqat 'sms' kanali, faqat 'yuborildi' holatidagi qator, faqat holat/xato. SECURITY DEFINER + search_path qat'iy.
CREATE FUNCTION sms_yetkazish_holati(p_bildirishnoma_id bigint, p_yetkazildi boolean, p_status text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE public.yetkazishlar
     SET holat = CASE WHEN p_yetkazildi THEN 'yuborildi' ELSE 'xato' END,
         oxirgi_xato = CASE WHEN p_yetkazildi THEN NULL ELSE 'sms: ' || left(p_status, 20) END,
         yangilangan_vaqt = now()
   WHERE bildirishnoma_id = p_bildirishnoma_id AND kanal = 'sms' AND holat = 'yuborildi';
$$;
REVOKE ALL ON FUNCTION sms_yetkazish_holati(bigint, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sms_yetkazish_holati(bigint, boolean, text) TO vazifalar_ilova;
