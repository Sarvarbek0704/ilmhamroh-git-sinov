import { test } from "vitest";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

// Vitest sukut timeout — 5 s (node:test da yo'q edi): bola jarayon Vite runner bilan yolg'iz ~3 s da ko'tariladi, parallel testlar bilan yuklangan mashinada 20 s dan oshdi (holat 30)
test("unhandledRejection: log → boshlangan so'rov tugaydi → exit 1 (let it crash)", { timeout: 60_000 }, async () => {
  const bola = spawn(process.execPath, [join(import.meta.dirname, "qolip", "yurgiz.mjs"), join(import.meta.dirname, "qolip", "halokat.ts")], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  bola.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
  const manzil = await new Promise<string>((resolve) => {
    bola.stdout.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
      const m = /http:\/\/[\d.]+:\d+/.exec(stdout);
      if (m) resolve(m[0]);
    });
  });
  const javob = await fetch(`${manzil}/v1/vazifalar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"matn":"x"}' });
  assert.equal(javob.status, 201); // halokatdan keyin ham boshlangan so'rov javob oldi
  const kod = await new Promise<number | null>((r) => bola.on("exit", r));
  assert.equal(kod, 1);
  assert.match(stderr, /unhandledRejection bildirishnoma yuborilmadi/);
  assert.match(stdout, /unhandledRejection: yangi ulanishlar qabul qilinmaydi/);
});
