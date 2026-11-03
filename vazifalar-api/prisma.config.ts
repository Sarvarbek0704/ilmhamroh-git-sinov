// prisma.config.ts — Prisma 7 CLI sozlamasi (27-qism). Prisma 7 .env ni O'ZI o'qimaydi: npm skriptlari `--env-file-if-exists=.env` bilan beradi.
// DATABASE_URL faqat bazaga ulanadigan buyruqlarga (migrate, db pull) kerak. env("DATABASE_URL") ishlatilsa, `prisma generate` ham
// URL'siz yiqiladi (PrismaConfigEnvError — o'lchandi, holat 20) — shuning uchun datasource faqat o'zgaruvchi bor bo'lsa beriladi.
import { defineConfig } from "prisma/config";

const url = process.env["DATABASE_URL"];

export default defineConfig({
  schema: "prisma/schema.prisma",
  // seed: `npx prisma db seed` (holat 39)
  migrations: { path: "prisma/migrations", seed: "node prisma/seed.ts" },
  // 31 #05: bo'limli jadval (sql/301) — Prisma bo'limlashni boshqara olmaydi: jadval migratsiya SQL'i bilan yaratiladi, Prisma unga TEGMAYDI
  // (migrate diff uni "ortiqcha" deb DROP yozmaydi). Bo'lim jadvallari — `bolimlar` sxemasida (Prisma faqat `public` ni ko'radi).
  experimental: { externalTables: true },
  tables: { external: ["public.vazifa_hodisalari", "public.vazifa_embeddinglar"] }, // 31 #17: vector(768) + HNSW — Prisma turini bilmaydi
  ...(url === undefined ? {} : { datasource: { url } }),
});
