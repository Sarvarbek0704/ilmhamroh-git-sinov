import { test } from "vitest";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { yop } from "../src/yopish.ts";

test("yop(): boshlangan so'rov tugaydi, yangisi rad etiladi, keep-alive kutilmaydi", async () => {
  const server = createServer((req, res) => setTimeout(() => res.end("tugadi"), req.url === "/uzoq" ? 300 : 0));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const asos = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  await (await fetch(asos)).text(); // keep-alive ulanish bo'sh qoladi
  const uzoq = fetch(`${asos}/uzoq`).then((r) => r.text());
  await new Promise((r) => setTimeout(r, 50));
  const t0 = performance.now();
  const yopildi = yop(server, 2000);
  await assert.rejects(
    new Promise((resolve, reject) => request(asos, resolve).on("error", reject).end()),
    { code: "ECONNREFUSED" },
  );
  assert.equal(await uzoq, "tugadi");
  assert.equal(await yopildi, true);
  // keepAliveTimeout (5 s + 1 s bufer) kutilmadi
  assert.ok(performance.now() - t0 < 1500, `${String(performance.now() - t0)} ms`);
});

test("yop(): kutish vaqti o'tsa majburan uzadi → false", async () => {
  const server = createServer(() => { /* hech qachon javob bermaydi */ });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const asos = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  const osilgan = fetch(asos).catch((x: unknown) => x);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await yop(server, 200), false);
  assert.ok((await osilgan) instanceof TypeError); // fetch failed — ulanish uzildi
});
