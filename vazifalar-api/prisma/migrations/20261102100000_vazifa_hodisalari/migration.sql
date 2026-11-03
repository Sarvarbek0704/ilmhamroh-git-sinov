-- 301-vazifa-hodisalari.sql — 31-qism #05 (DB-127 partitioning) va #09 (DB-131 time-series): vazifa hodisalari oqimi.
-- Faqat qo'shiladigan (append-only) vaqt qatori: kim (egasi), qachon, qaysi vazifa, nima bo'ldi. `vazifa_tarixi` (010) — audit (eski/yangi qiymat),
-- bu jadval — analitika (sanash, grafik, retention). Oyma-oy RANGE bo'limlar: eski oy — DROP (DELETE emas, #12), so'rov — faqat kerakli bo'limlar (pruning).
-- Bo'limlar ALOHIDA sxemada (`bolimlar`): Prisma faqat `public` ni ko'radi — bo'lim jadvallari migrate diff'ga tushmaydi; ota jadval — prisma.config.ts
-- `tables.external` (Prisma 7.10 experimental.externalTables) — Prisma uni o'zgartirmaydi.
CREATE SCHEMA bolimlar;

CREATE TABLE vazifa_hodisalari (
  vaqt      timestamptz NOT NULL DEFAULT now(),
  egasi_id  bigint      NOT NULL,
  vazifa_id bigint,                        -- FK YO'Q: vazifa butunlay o'chsa ham hodisa (statistika) qoladi; bo'limli jadvalga FK — har bo'limda indeks narxi
  tur       text        NOT NULL,
  malumot   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT vazifa_hodisalari_tur_check CHECK (tur IN ('yaratildi', 'bajarildi', 'qaytarildi', 'ochirildi', 'tiklandi', 'ai_qadamlar', 'ai_savol', 'semantik_qidiruv'))
  -- PRIMARY KEY yo'q: bo'limli jadvalda noyob indeks bo'lim kalitini (vaqt) o'z ichiga olishi SHART — (id) yolg'iz noyob bo'lolmaydi (#05 cheklovi)
) PARTITION BY RANGE (vaqt);

-- BRIN — vaqt tartibida yoziladigan jadval uchun: kichik (bir necha sahifa), oraliq so'rovlari uchun yetarli (t05 o'lchovi: btree bilan solishtirish)
CREATE INDEX vazifa_hodisalari_vaqt_brin ON vazifa_hodisalari USING brin (vaqt);
CREATE INDEX vazifa_hodisalari_egasi_vaqt ON vazifa_hodisalari (egasi_id, vaqt);

-- bo'lim nomi: bolimlar.vazifa_hodisalari_YYYY_MM; chegaralar UTC oy boshida (bo'lim kaliti — timestamptz, sessiya zonasidan mustaqil)
CREATE FUNCTION hodisa_bolimi_yarat(oy date) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  bosh timestamptz := (date_trunc('month', oy)::timestamp AT TIME ZONE 'UTC');
  nom  text := format('vazifa_hodisalari_%s', to_char(oy, 'YYYY_MM'));
BEGIN
  IF to_regclass(format('bolimlar.%I', nom)) IS NULL THEN
    EXECUTE format('CREATE TABLE bolimlar.%I PARTITION OF public.vazifa_hodisalari FOR VALUES FROM (%L) TO (%L)', nom, bosh, bosh + interval '1 month');
  END IF;
  RETURN nom;
END $$;

-- joriy oy + `oldinga` oy (cron har kuni chaqiradi — idempotent); DEFAULT bo'lim — kutilmagan vaqt (masalan soat noto'g'ri) yo'qolmasin
CREATE FUNCTION hodisa_bolimlari_tayyorla(oldinga integer DEFAULT 2) RETURNS SETOF text
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT hodisa_bolimi_yarat((date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => g))::date) FROM generate_series(0, oldinga) g
$$;
CREATE TABLE bolimlar.vazifa_hodisalari_boshqa PARTITION OF vazifa_hodisalari DEFAULT;
SELECT hodisa_bolimlari_tayyorla(2);

-- #12 saqlash muddati: yuqori chegarasi `saqlash` dan eski bo'limlar — DETACH + DROP (sekundlar; DELETE — har qator WAL'ga, VACUUM kerak)
CREATE FUNCTION hodisa_bolimlari_tozala(saqlash interval DEFAULT interval '13 months') RETURNS SETOF text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE b record;
BEGIN
  FOR b IN
    SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) AS chegara
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE i.inhparent = 'public.vazifa_hodisalari'::regclass AND n.nspname = 'bolimlar' AND c.relname ~ '^vazifa_hodisalari_\d{4}_\d{2}$'
     ORDER BY c.relname
  LOOP
    IF to_date(right(b.relname, 7), 'YYYY_MM') + interval '1 month' <= (now() AT TIME ZONE 'UTC') - saqlash THEN
      EXECUTE format('ALTER TABLE public.vazifa_hodisalari DETACH PARTITION bolimlar.%I', b.relname);
      EXECUTE format('DROP TABLE bolimlar.%I', b.relname);
      RETURN NEXT b.relname;
    END IF;
  END LOOP;
END $$;

-- Trigger: vazifalar o'zgarishi → hodisa (API kodi o'zgarmaydi; tranzaksiya bilan birga — hodisa yo'qolmaydi)
CREATE FUNCTION vazifa_hodisasi_yoz() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  IF TG_OP = 'INSERT' THEN t := 'yaratildi';
  ELSIF NEW.ochirilgan_vaqt IS NOT NULL AND OLD.ochirilgan_vaqt IS NULL THEN t := 'ochirildi';
  ELSIF NEW.ochirilgan_vaqt IS NULL AND OLD.ochirilgan_vaqt IS NOT NULL THEN t := 'tiklandi';
  ELSIF NEW.bajarildi AND NOT OLD.bajarildi THEN t := 'bajarildi';
  ELSIF OLD.bajarildi AND NOT NEW.bajarildi THEN t := 'qaytarildi';
  ELSE RETURN NULL;
  END IF;
  INSERT INTO vazifa_hodisalari (egasi_id, vazifa_id, tur) VALUES (NEW.egasi_id, NEW.id, t);
  RETURN NULL;
END $$;
CREATE TRIGGER vazifalar_hodisa AFTER INSERT OR UPDATE OF bajarildi, ochirilgan_vaqt ON vazifalar
  FOR EACH ROW EXECUTE FUNCTION vazifa_hodisasi_yoz();

-- Huquqlar va RLS: ilova faqat o'z hodisalarini o'qiydi/yozadi; bo'lim jadvallariga to'g'ridan huquq yo'q (faqat ota orqali — siyosat ishlaydi)
GRANT SELECT, INSERT ON vazifa_hodisalari TO vazifalar_ilova;
GRANT SELECT ON vazifa_hodisalari TO vazifalar_ishchi;
ALTER TABLE vazifa_hodisalari ENABLE ROW LEVEL SECURITY;
CREATE POLICY vazifa_hodisalari_egasi ON vazifa_hodisalari TO vazifalar_ilova
  USING (egasi_id = joriy_foydalanuvchi()) WITH CHECK (egasi_id = joriy_foydalanuvchi());
REVOKE EXECUTE ON FUNCTION hodisa_bolimi_yarat(date), hodisa_bolimlari_tayyorla(integer), hodisa_bolimlari_tozala(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hodisa_bolimi_yarat(date), hodisa_bolimlari_tayyorla(integer) TO vazifalar_ilova, vazifalar_ishchi;
GRANT EXECUTE ON FUNCTION hodisa_bolimlari_tozala(interval) TO vazifalar_ishchi;

COMMENT ON TABLE vazifa_hodisalari IS '31 #05/#09: vazifa hodisalari vaqt qatori — oylik RANGE bo''limlar (bolimlar sxemasi), BRIN, 13 oy saqlanadi (#12)';
