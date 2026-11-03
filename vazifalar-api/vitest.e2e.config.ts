// vitest.e2e.config.ts — haqiqiy brauzer testlari (Playwright Chromium): CSRF, CORS, passkey (WebAuthn virtual autentifikatori).
// Ketma-ket (fileParallelism: false) — 28 dagi `node --test --test-concurrency=1`: brauzer va portlar bir-biriga xalaqit bermasin
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.ts"],
    env: { LOG_LEVEL: "silent" },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
