// e2e/yordam.ts — haqiqiy brauzer (Playwright Chromium) testlari uchun: API'ni Postgres bilan tasodifiy portda ishga tushirish, "hujumchi" sahifalari serveri.
// Brauzer: `npx playwright install chromium` o'rnatgani; boshqa joyda bo'lsa — CHROMIUM_YOLI (masalan, kanon mashinasida headless shell 1234).
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import express from "express";
import { ilovaYarat } from "../src/ilova.ts";
import type { Bogliqliklar } from "../src/ilova.ts";
import { authBogliqliklari, xatToken } from "../test/auth-yordam.ts";
import type { TestAuth } from "../test/auth-yordam.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { yop } from "../src/yopish.ts";
import type { Pool } from "pg";

export async function brauzer(): Promise<Browser> {
  const yol = process.env["CHROMIUM_YOLI"];
  return chromium.launch(yol === undefined || yol === "" ? {} : { executablePath: yol });
}

/** API: 127.0.0.1:<tasodifiy port>; brauzer uni http://localhost:<port> deb ochadi (Chromium localhost'ni loopback'ga hal qiladi) */
export async function api(pool: Pool, qoshimcha: Partial<Bogliqliklar> = {}): Promise<{ asos: string; auth: TestAuth; xat: (kimga?: string) => Promise<string>; yop: () => Promise<boolean> }> {
  const auth = authBogliqliklari(pool);
  // /frontend.html — "frontend" sahifasi API bilan bir origin'da (prod'da nginx beradi). API'ning o'z sahifalari CSP 'none' (#24) — ulardan fetch ham taqiqlangan,
  // shuning uchun test sahifasi API middleware'laridan OLDIN, tashqi express'da
  const tashqi = express();
  tashqi.get("/frontend.html", (_q, r) => { r.type("html").send("<!doctype html><meta charset=utf-8><p>frontend</p>"); });
  // Nest (30 B): ilova init qilingan Express nusxasi tashqi express'ga ulanadi; yopishda Nest lifecycle ham (app.close)
  const app = await ilovaYarat({ ombor: (egasi) => new PgOmbori(pool, egasi), auth, ...qoshimcha });
  tashqi.use(app.getHttpAdapter().getInstance());
  const server = createServer(tashqi);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { asos: `http://localhost:${String((server.address() as AddressInfo).port)}`, auth, xat: (kimga) => xatToken(auth, kimga), yop: async () => { const n = await yop(server, 2000); await app.close(); return n; } };
}

/** Bitta HTML sahifa beradigan server (hujumchi sayti). host — brauzer qaysi nom bilan ochadi (localhost — bir sayt, 127.0.0.1 — boshqa sayt) */
export async function sahifaServer(html: (port: number) => string): Promise<{ port: number; server: Server }> {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html((server.address() as AddressInfo).port));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { port: (server.address() as AddressInfo).port, server };
}
