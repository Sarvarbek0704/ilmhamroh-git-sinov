-- 206-webhook-hodisa.sql — 29-qism B (holat 35): vazifa hodisasini foydalanuvchining webhook obunalariga navbatga qo'yish — tor huquq.
-- API roli (vazifalar_ilova) webhook_yetkazishlar'ga yoza olmaydi (203 REVOKE) — jadvalga INSERT berish o'rniga bitta amal:
-- faqat JORIY foydalanuvchining (RLS konteksti: set_config('ilova.foydalanuvchi_id')) faol obunalariga, hodisa turi obunada bo'lsa.
-- Kontekst o'rnatilmagan bo'lsa (joriy_foydalanuvchi() IS NULL) — 0 qator. Holat 50 da outbox relay ham shu funksiyani chaqiradi.
CREATE FUNCTION webhook_hodisa_qosh(p_tur text, p_hodisa_id text, p_tana jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.webhook_yetkazishlar (obuna_id, hodisa_id, tur, tana)
  SELECT o.id, p_hodisa_id, p_tur, p_tana FROM public.webhook_obunalari o
   WHERE o.foydalanuvchi_id = public.joriy_foydalanuvchi() AND o.faol AND p_tur = ANY(o.hodisalar)
  ON CONFLICT (obuna_id, hodisa_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION webhook_hodisa_qosh(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION webhook_hodisa_qosh(text, text, jsonb) TO vazifalar_ilova, vazifalar_ishchi;
