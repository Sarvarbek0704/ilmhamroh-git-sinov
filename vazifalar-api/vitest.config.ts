// vitest.config.ts — Nest 12 ESM loyihalarining sukut test vositasi. Vite 8 (oxc) dekoratorlar metama'lumotini tsconfig'dan oladi (SWC plaginsiz)
import { defineConfig } from "vitest/config";

/**
 * 30 C: SSE testlari (jonli, outbox) Redis'ning UMUMIY Pub/Sub kanalini (`vz:jonli`) tinglaydi — parallel yugursa bir-birining hodisasini oladi
 * (birinchi to'liq yugurishda jonli.test outbox.test'ning "oyna-7" hodisasini oldi). Ular alohida loyihada, ketma-ket; qolgani — parallel.
 */
const KANAL_TESTLARI = ["test/jonli.test.ts", "test/outbox.test.ts"];

export default defineConfig({
  test: {
    // holat 30: config process.env dan (ConfigModule) — testlar jim bo'lsin (o'z logini bergan testlar — xotiraLogi — bundan mustasno)
    env: { LOG_LEVEL: "silent" },
    // Vitest sukuti 5 s (node:test — cheksiz): baza bilan ishlaydigan testlar yuklangan mashinada 5–7 s oldi (holat 30, prisma-ombor) — 20 s
    testTimeout: 20_000,
    hookTimeout: 30_000,
    projects: [
      // 25–27 dagi fayl nomlari saqlandi (test/*.test.ts); Nest odati — *.spec.ts / *.e2e-spec.ts (ikkalasi ham qamraladi)
      { extends: true, test: { name: "asosiy", include: ["test/**/*.test.ts", "src/**/*.spec.ts"], exclude: KANAL_TESTLARI } },
      { extends: true, test: { name: "redis-kanal", include: KANAL_TESTLARI, fileParallelism: false } },
    ],
  },
});
