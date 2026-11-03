// yordamchi.ts — testlar uchun: serverni tasodifiy portda (0) ishga tushirish va xom HTTP so'rov
import { request } from "node:http";
import type { IncomingHttpHeaders, RequestListener, Server } from "node:http";
import { ilovaYarat } from "../src/ilova.ts";
import type { Bogliqliklar } from "../src/ilova.ts";
import { ishgaTushir as ishga } from "../src/ishga-tushir.ts";
import { yop as serverniYop } from "../src/yopish.ts";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";
import { logYarat } from "../src/umumiy/log.ts";
import type { Log } from "../src/umumiy/log.ts";

export const FRONTEND = "http://localhost:5173";

export async function ishgaTushir(): Promise<{ asos: string; yop: () => Promise<boolean> }> {
  const { server, manzil } = await ishga({ port: 0, bogliqliklar: { ombor: new XotiraOmbori(), corsOriginlar: [FRONTEND] } });
  return { asos: manzil, yop: () => serverniYop(server, 2000) };
}

export function jsonYubor(metod: string, tana: unknown): RequestInit {
  return { method: metod, headers: { "Content-Type": "application/json" }, body: JSON.stringify(tana) };
}

export type XomJavob = { holat: number; sarlavhalar: IncomingHttpHeaders; tana: string };

/**
 * node:http bilan so'rov. Nega fetch emas: fetch (undici) If-None-Match bor so'rovga o'zi
 * `Cache-Control: no-cache` + `Pragma: no-cache` qo'shadi (Fetch standarti) — Express (fresh) esa
 * no-cache'li so'rovga 304 bermaydi. Shartli so'rovlarni xom so'rov bilan tekshiramiz.
 */
export function xomSorov(url: string, { metod = "GET", sarlavhalar = {}, tana }: { metod?: string; sarlavhalar?: Record<string, string>; tana?: string } = {}): Promise<XomJavob> {
  return new Promise((resolve, reject) => {
    const so = request(url, { method: metod, headers: sarlavhalar }, (res) => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => (b += d));
      res.on("end", () => { resolve({ holat: res.statusCode ?? 0, sarlavhalar: res.headers, tana: b }); });
    });
    so.on("error", reject);
    so.end(tana);
  });
}

/** Xotiradagi Pino logi: har qator — JSON obyekt (testda nima yozilganini tekshirish uchun) */
export function xotiraLogi(daraja = "info"): { log: Log; qatorlar: Record<string, unknown>[] } {
  const qatorlar: Record<string, unknown>[] = [];
  const log = logYarat(daraja, { write: (q: string) => { qatorlar.push(JSON.parse(q) as Record<string, unknown>); } });
  return { log, qatorlar };
}

/** supertest uchun: Nest ilovasi (init qilingan, listen qilinmagan) http serveri — request(server) o'zi vaqtinchalik tinglatadi */
export async function httpIlova(b: Bogliqliklar): Promise<Server> {
  return (await ilovaYarat(b)).getHttpServer();
}

/** Express ilovasi sifatida (28 testlari: `server.on("request", app)`, `tashqi.use(app)` — oidc, e2e). Nest init qilingan, listen qilinmagan */
export async function expressIlova(b: Bogliqliklar): Promise<RequestListener> {
  return (await ilovaYarat(b)).getHttpAdapter().getInstance() as RequestListener;
}
