-- 307-bolim-kochirish.sql — 32-qism #01 (31 nuqsoni): DEFAULT bo'limda shu oyning qatori bo'lsa `CREATE TABLE … PARTITION OF` yiqilardi
-- ("updated partition constraint for default partition … would be violated by some row"), BolimlarXizmati esa xatoni `warn` bilan yutardi —
-- bo'lim hech qachon yaratilmas, DEFAULT jimgina o'saverardi. Endi: DEFAULT qulflanadi → oy jadvali alohida yaratiladi → shu oy qatorlari DEFAULT'dan
-- unga KO'CHIRILADI → ATTACH PARTITION. Funksiya bitta tranzaksiyada: yarmida yiqilsa hech narsa o'zgarmaydi (qator yo'qolmaydi, ikki marta ham yozilmaydi).
CREATE OR REPLACE FUNCTION hodisa_bolimi_yarat(oy date) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  bosh timestamptz := (date_trunc('month', oy)::timestamp AT TIME ZONE 'UTC');
  oxir timestamptz := (date_trunc('month', oy)::timestamp AT TIME ZONE 'UTC') + interval '1 month';
  nom  text := format('vazifa_hodisalari_%s', to_char(oy, 'YYYY_MM'));
  n    bigint;
BEGIN
  IF to_regclass(format('bolimlar.%I', nom)) IS NOT NULL THEN
    RETURN nom;
  END IF;
  -- ko'chirish va ATTACH orasida shu oyga yangi qator DEFAULT'ga tushmasin: yozuvchilar shu qisqa vaqt kutadi (o'quvchilar — yo'q)
  LOCK TABLE bolimlar.vazifa_hodisalari_boshqa IN EXCLUSIVE MODE;
  EXECUTE format('CREATE TABLE bolimlar.%I (LIKE public.vazifa_hodisalari INCLUDING DEFAULTS INCLUDING CONSTRAINTS)', nom);
  EXECUTE format('WITH k AS (DELETE FROM bolimlar.vazifa_hodisalari_boshqa WHERE vaqt >= %L AND vaqt < %L RETURNING *) INSERT INTO bolimlar.%I SELECT * FROM k',
                 bosh, oxir, nom);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'hodisa_bolimi_yarat: % qator DEFAULT bo''limdan bolimlar.% ga ko''chirildi', n, nom;
  END IF;
  -- ATTACH: indekslar (BRIN, egasi+vaqt) avtomatik yaratiladi; chegara tekshiruvi — kichik jadvalda bitta skan
  EXECUTE format('ALTER TABLE public.vazifa_hodisalari ATTACH PARTITION bolimlar.%I FOR VALUES FROM (%L) TO (%L)', nom, bosh, oxir);
  RETURN nom;
END $$;
