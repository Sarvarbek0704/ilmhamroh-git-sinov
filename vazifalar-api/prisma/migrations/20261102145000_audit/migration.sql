-- 305-audit.sql — 31-qism #23 (B-214): audit jurnali — KIM, QACHON, NIMANI (admin amallari, hisob o'chirish, API kalitlar, bayroqlar).
-- `vazifa_tarixi` (010) — ma'lumot o'zgarishi (trigger); `auth_hodisalar` (111) — xavfsizlik hodisalari (180 kun saqlanadi); audit — javobgarlik: o'zgarmas va uzoq saqlanadi.
-- O'zgarmaslik: (1) faqat qo'shiladi — UPDATE/DELETE/TRUNCATE trigger bilan taqiqlangan (superuser ham — trigger'ni ataylab o'chirmasa);
-- (2) hash zanjiri: har yozuv hash = sha256(oldingi_hash || maydonlar) — trigger o'chirilib qator o'zgartirilsa ham audit_tekshir() uzilgan joyni topadi.
-- Alohida sxema `audit`: Prisma (public) va testlardagi TRUNCATE (public jadvallari) unga tegmaydi; ilova rollariga — faqat audit_yoz() funksiyasi.
CREATE SCHEMA audit;

CREATE TABLE audit.jurnal (
  id           bigint      GENERATED ALWAYS AS IDENTITY,
  vaqt         timestamptz NOT NULL,
  aktyor_id    bigint,                         -- FK yo'q: aktyor hisobi o'chirilsa (302) ham yozuv qoladi
  amal         text        NOT NULL,
  obyekt       text,
  obyekt_id    text,
  tafsilot     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sorov_id     text,
  oldingi_hash bytea,
  hash         bytea       NOT NULL,
  CONSTRAINT jurnal_pkey PRIMARY KEY (id),
  CONSTRAINT jurnal_amal_check CHECK (amal ~ '^[a-z][a-z0-9_.-]{1,59}$')
);
CREATE INDEX jurnal_aktyor_vaqt ON audit.jurnal (aktyor_id, vaqt);
CREATE INDEX jurnal_obyekt ON audit.jurnal (obyekt, obyekt_id);

-- hash qilinadigan kanonik satr (tekshiruv ham AYNAN shu funksiyadan foydalanadi)
CREATE FUNCTION audit.satr(j audit.jurnal) RETURNS bytea
LANGUAGE sql IMMUTABLE
RETURN convert_to(concat_ws('|', j.id, to_char(j.vaqt AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), j.aktyor_id, j.amal, j.obyekt, j.obyekt_id, j.tafsilot::text, j.sorov_id), 'UTF8');

CREATE FUNCTION audit_yoz(aktyor bigint, amal text, obyekt text, obyekt_id text, tafsilot jsonb, sorov_id text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, audit AS $$
DECLARE oldingi bytea; j audit.jurnal;
BEGIN
  -- zanjir tartibi: bir vaqtda ikki yozuv bir xil "oldingi"ni olmasin (tranzaksiya oxirigacha qulf)
  PERFORM pg_advisory_xact_lock(hashtext('audit.jurnal'));
  SELECT hash INTO oldingi FROM audit.jurnal ORDER BY id DESC LIMIT 1;
  j.id := nextval(pg_get_serial_sequence('audit.jurnal', 'id'));
  j.vaqt := date_trunc('microseconds', clock_timestamp());
  j.aktyor_id := aktyor; j.amal := amal; j.obyekt := obyekt; j.obyekt_id := obyekt_id; j.tafsilot := coalesce(tafsilot, '{}'); j.sorov_id := sorov_id;
  j.oldingi_hash := oldingi;
  j.hash := sha256(coalesce(oldingi, '\x'::bytea) || audit.satr(j));
  INSERT INTO audit.jurnal OVERRIDING SYSTEM VALUE SELECT j.*;
  RETURN j.id;
END $$;

-- zanjirni tekshirish: buzilgan birinchi yozuvlar (bo'sh natija — butun)
CREATE FUNCTION audit_tekshir() RETURNS TABLE (id bigint, sabab text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, audit AS $$
  SELECT x.id, x.sabab FROM (
    SELECT j.id,
           CASE WHEN j.oldingi_hash IS DISTINCT FROM lag(j.hash) OVER (ORDER BY j.id) THEN 'oldingi_hash zanjirga mos emas (yozuv o''chirilgan yoki qo''shilgan)'
                WHEN j.hash <> sha256(coalesce(j.oldingi_hash, '\x'::bytea) || audit.satr(j)) THEN 'hash mos emas (yozuv o''zgartirilgan)' END AS sabab
      FROM audit.jurnal j) x
   WHERE x.sabab IS NOT NULL ORDER BY x.id
$$;

CREATE FUNCTION audit.ozgartirish_taqiq() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit.jurnal faqat qo''shiladi (%)', TG_OP USING ERRCODE = '42501'; END $$;
CREATE TRIGGER jurnal_ozgarmas BEFORE UPDATE OR DELETE ON audit.jurnal FOR EACH ROW EXECUTE FUNCTION audit.ozgartirish_taqiq();
CREATE TRIGGER jurnal_ozgarmas_truncate BEFORE TRUNCATE ON audit.jurnal FOR EACH STATEMENT EXECUTE FUNCTION audit.ozgartirish_taqiq();

REVOKE ALL ON SCHEMA audit FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION audit_yoz(bigint, text, text, text, jsonb, text), audit_tekshir() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_yoz(bigint, text, text, text, jsonb, text) TO vazifalar_ilova, vazifalar_auth;
GRANT EXECUTE ON FUNCTION audit_tekshir() TO vazifalar_auth;
-- admin ro'yxati (GET /v1/admin/audit) — auth roli o'qiydi
GRANT USAGE ON SCHEMA audit TO vazifalar_auth;
GRANT SELECT ON audit.jurnal TO vazifalar_auth;

COMMENT ON TABLE audit.jurnal IS '31 #23: audit jurnali — faqat qo''shiladi (trigger), hash zanjiri (audit_tekshir)';
