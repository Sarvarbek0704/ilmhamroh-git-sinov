import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  // src/generated — `prisma generate` natijasi (git'da yo'q, lint qilinmaydi); dist — nest build natijasi
  { ignores: ["dist/", "public/", "src/generated/"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  { languageOptions: { parserOptions: { projectService: true } } },
  {
    rules: {
      // node:test `test()` Promise qaytarardi (24-qism #08); Vitest test() — void. Qoida qoladi: testlar ichidagi unutilgan Promise xato
      "@typescript-eslint/no-floating-promises": [
        "error",
        { allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test", "describe", "it", "suite"] }] },
      ],
      // Nest: `@Module({...}) export class AppModule {}` — bo'sh klass dekorator bilan ma'noli (metama'lumot tashuvchi)
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
    },
  },
  { files: ["**/*.js", "**/*.mjs"], extends: [tseslint.configs.disableTypeChecked], languageOptions: { globals: { process: "readonly", console: "readonly" } } },
);
