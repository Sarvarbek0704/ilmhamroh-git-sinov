-- 302-saqlash-muddati.sql — 31-qism #11 (S-41) va #12 (DB-133): saqlash muddati, tozalash va hisobni anonimlashtirish ("unutilish huquqi").
-- Siyosat (docs/MAXFIYLIK.md): yumshoq o'chirilgan vazifalar — 30 kun, kirish hodisalari — 180 kun, sessiya/token/OTP — muddatidan 7 kun keyin,
-- vazifa hodisalari — 13 oy (301: bo'lim DROP). Funksiyalar SECURITY DEFINER (migratsiya egasi nomidan), search_path qotirilgan; kim chaqira olishi — GRANT bilan.

-- 1) Yumshoq o'chirilganlarni HAQIQIY o'chirish (CASCADE: teglar bog'lanishi, izohlar, ilovalar → fayllar yetim bo'ladi va ishchi S3 dan tozalaydi)
CREATE FUNCTION ochirilganlarni_tozala(saqlash interval DEFAULT interval '30 days', paket integer DEFAULT 5000) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE jami bigint := 0; n bigint;
BEGIN
  LOOP  -- paketlab: bitta katta DELETE uzun qulf va katta WAL to'lqini beradi
    DELETE FROM vazifalar WHERE id IN (SELECT id FROM vazifalar WHERE ochirilgan_vaqt < now() - saqlash ORDER BY id LIMIT paket);
    GET DIAGNOSTICS n = ROW_COUNT;
    jami := jami + n;
    EXIT WHEN n < paket;
  END LOOP;
  RETURN jami;
END $$;

-- 2) Auth qoldiqlari: tugagan sessiya/token/OTP va eski kirish hodisalari (IP, user-agent — shaxsiy ma'lumot)
CREATE FUNCTION auth_tozala(hodisa_saqlash interval DEFAULT interval '180 days') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE s bigint; t bigint; o bigint; h bigint;
BEGIN
  DELETE FROM sessiyalar WHERE coalesce(bekor_vaqti, tugash_vaqti) < now() - interval '7 days';
  GET DIAGNOSTICS s = ROW_COUNT;
  DELETE FROM bir_martalik_tokenlar WHERE tugash_vaqti < now() - interval '7 days';
  GET DIAGNOSTICS t = ROW_COUNT;
  DELETE FROM otp_kodlar WHERE tugash_vaqti < now() - interval '7 days';
  GET DIAGNOSTICS o = ROW_COUNT;
  DELETE FROM auth_hodisalar WHERE vaqt < now() - hodisa_saqlash;
  GET DIAGNOSTICS h = ROW_COUNT;
  RETURN jsonb_build_object('sessiyalar', s, 'tokenlar', t, 'otp', o, 'auth_hodisalar', h);
END $$;

-- 3) Hisobni o'chirish = anonimlashtirish: foydalanuvchi qatori QOLADI (id — statistika, hodisalar uchun psevdonim), lekin unga bog'liq shaxsiy
--    narsa qolmaydi. foydalanuvchilar'ga FK bilan bog'langan HAMMA CASCADE jadvaldan qatorlar o'chiriladi — ro'yxat katalogdan (pg_constraint) olinadi:
--    keyin qo'shilgan jadval (masalan ai_sarf) ham avtomatik qamraladi. Istisnolar: auth_hodisalar (IP/user-agent tozalanadi, hodisa qoladi), fayllar
--    (qatorlar qoladi → yetim bo'ladi → ishchi S3 obyektini va qatorni o'chiradi — S3'ni SQL o'chira olmaydi).
CREATE FUNCTION hisob_anonimlashtir(fid bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE f record; n bigint; natija jsonb := '{}';
BEGIN
  PERFORM 1 FROM foydalanuvchilar WHERE id = fid FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  FOR f IN
    SELECT c.conrelid::regclass::text AS jadval, a.attname AS ustun
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'public.foydalanuvchilar'::regclass AND c.confdeltype = 'c'
       AND c.conrelid NOT IN ('public.auth_hodisalar'::regclass, 'public.fayllar'::regclass)
     ORDER BY 1
  LOOP
    EXECUTE format('DELETE FROM %s WHERE %I = $1', f.jadval, f.ustun) USING fid;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN natija := natija || jsonb_build_object(f.jadval, n); END IF;
  END LOOP;
  UPDATE auth_hodisalar SET ip = NULL, user_agent = NULL, tafsilot = '{}' WHERE foydalanuvchi_id = fid;
  UPDATE foydalanuvchilar
     SET email = format('ochirilgan-%s@ochirilgan.invalid', id), toliq_ism = 'O''chirilgan foydalanuvchi', parol_hash = NULL, telefon = NULL, sozlamalar = '{}',
         email_tasdiqlangan_vaqt = NULL, rol = 'foydalanuvchi', bloklangan_vaqt = now()
   WHERE id = fid;
  INSERT INTO auth_hodisalar (foydalanuvchi_id, tur) VALUES (fid, 'hisob_ochirildi');
  RETURN natija;
END $$;

REVOKE EXECUTE ON FUNCTION ochirilganlarni_tozala(interval, integer), auth_tozala(interval), hisob_anonimlashtir(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ochirilganlarni_tozala(interval, integer), auth_tozala(interval) TO vazifalar_ishchi;
GRANT EXECUTE ON FUNCTION hisob_anonimlashtir(bigint) TO vazifalar_auth;

COMMENT ON FUNCTION hisob_anonimlashtir(bigint) IS '31 #12: hisobni o''chirish — shaxsiy ma''lumotlar yo''q qilinadi, id psevdonim sifatida qoladi (statistika)';
