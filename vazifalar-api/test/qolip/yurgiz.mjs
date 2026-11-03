// yurgiz.mjs <fayl.ts> — TS faylni alohida jarayonda Vite module runner orqali ishga tushiradi (Vitest bilan bir xil o'girish:
// dekoratorlar + emitDecoratorMetadata). Nega kerak: Nest kodi (dekoratorlar) Node type stripping'da ISHLAMAYDI — 27 dagi
// `node qolip/halokat.ts` endi "SyntaxError: Invalid or unexpected token" beradi
import { runnerImport } from "vite";

await runnerImport(process.argv[2], { logLevel: "silent" });
