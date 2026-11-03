-- 113-sessiya-eslab-qol.sql — 28-qism #11 (B-115, holat 11): "Meni eslab qol" va sessiyaga xos bo'sh turish chegarasi.
-- Eslab qolinmagan sessiya: brauzer yopilguncha cookie (Expires'siz) + qisqa idle; eslab qolingan: 30 kunlik cookie + 7 kunlik idle (sliding).
-- Mavjud qatorlar (112) — eslab qolingan deb hisoblanadi (oldingi xulq o'zgarmaydi): DEFAULT bilan ADD COLUMN — PG 11+ da jadvalni qayta yozmaydi.
ALTER TABLE sessiyalar ADD COLUMN eslab_qol boolean NOT NULL DEFAULT true;
ALTER TABLE sessiyalar ADD COLUMN idle_muddat interval NOT NULL DEFAULT interval '7 days';
ALTER TABLE sessiyalar ADD CONSTRAINT sessiyalar_idle_muddat_check CHECK (idle_muddat BETWEEN interval '1 minute' AND interval '400 days');

COMMENT ON COLUMN sessiyalar.idle_muddat IS 'Shu sessiya uchun bo''sh turish chegarasi (#11): oxirgi_faollik + idle_muddat > now()';
