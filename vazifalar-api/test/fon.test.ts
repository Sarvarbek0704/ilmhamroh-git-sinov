// fon.test.ts — #12: FonIshlar — javobni kutdirmaydi, xato jim yutilmaydi (log'ga), tugashi() hamma ishni kutadi (ichida qo'shilganini ham)
import { test } from "vitest";
import assert from "node:assert/strict";
import { setTimeout as kut } from "node:timers/promises";
import { FonIshlar } from "../src/umumiy/fon.ts";

test("qosh() kutmaydi; xato log'ga; tugashi() — ichki ishlar bilan birga", async () => {
  const xatolar: string[] = [];
  const fon = new FonIshlar(() => ({ error: (o, x) => { xatolar.push(`${o.ish}: ${String(o.err)} — ${x}`); } }));
  const bajarildi: string[] = [];
  const b = performance.now();
  fon.qosh("a", async () => { await kut(30); bajarildi.push("a"); fon.qosh("ichki", async () => { await kut(10); bajarildi.push("ichki"); }); });
  fon.qosh("xato", () => Promise.reject(new Error("SMTP o'chiq")));
  assert.ok(performance.now() - b < 10);
  assert.deepEqual(bajarildi, []);
  await fon.tugashi();
  assert.deepEqual(bajarildi, ["a", "ichki"]);
  assert.deepEqual(xatolar, ["xato: Error: SMTP o'chiq — fon ishi bajarilmadi"]);
});
