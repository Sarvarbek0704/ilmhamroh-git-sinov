// metrikalar.ts — 31-qism #28 (B-219): Prometheus metrikalari (prom-client). RED: Rate (so'rovlar soni), Errors (5xx), Duration (gistogramma);
// USE — jarayon metrikalari (CPU, xotira, event loop kechikishi — collectDefaultMetrics). AI tokenlari — hozircha log (ai: { tokenlar }) orqali.
// Yorliq (label) kardinalligi: yo'l — MARSHRUT SHABLONI (`/v1/vazifalar/:id`), haqiqiy URL EMAS (har id yangi qator → Prometheus xotirasi portlaydi);
// mos marshrut topilmasa — "boshqa". /metrics — kirishsiz, lekin METRIKA_TOKEN berilsa `Authorization: Bearer` talab qilinadi (ochiq internetga chiqarilmaydi).
import type { NextFunction, Request, Response } from "express";
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/**
 * 32 #01 (31 nuqsoni): fon ishlari xatolari — log bilan birga METRIKA (alert qoidasi shu hisoblagichga yoziladi: `increase(fon_ishlari_xatolari_jami[1h]) > 0`).
 * Modul darajasida (DI'siz): fon xizmatlari Nest konteyneridan tashqarida ham (testda) ishlatiladi; har Metrikalar reestri uni o'ziga qo'shadi.
 */
export const fonXatolari = new Counter({ name: "fon_ishlari_xatolari_jami", help: "Fon ishlari (cron) xatolari", labelNames: ["ish"] as const, registers: [] });

export class Metrikalar {
  readonly reestr = new Registry();
  readonly sorovlar = new Counter({ name: "http_sorovlar_jami", help: "HTTP so'rovlar soni", labelNames: ["metod", "yol", "status"] as const, registers: [this.reestr] });
  readonly davomiylik = new Histogram({
    name: "http_sorov_davomiyligi_soniya", help: "HTTP javob vaqti (s)", labelNames: ["metod", "yol"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], registers: [this.reestr],
  });

  constructor(standart = true) {
    this.reestr.setDefaultLabels({ ilova: "vazifalar-api" });
    this.reestr.registerMetric(fonXatolari);
    if (standart) collectDefaultMetrics({ register: this.reestr });
  }

  /** Express middleware — Nest marshrutlaridan OLDIN ulanadi; javob tugaganda (finish) yoziladi — marshrut shabloni o'shanda ma'lum */
  middleware() {
    return (req: Request, res: Response, keyingi: NextFunction): void => {
      if (req.path === "/metrics") { keyingi(); return; }
      const t0 = process.hrtime.bigint();
      res.on("finish", () => {
        const shablon = (req.route as { path?: unknown } | undefined)?.path;
        // mos marshrut yo'q — Nest'ning 404 "catch-all" yo'li (`{/*splat}` — 1-yugurishda shunday yorliq chiqdi) yoki shablon yo'q → "boshqa"
        const yol = typeof shablon === "string" && !shablon.includes("*") ? `${req.baseUrl}${shablon}` : "boshqa";
        const s = Number(process.hrtime.bigint() - t0) / 1e9;
        this.sorovlar.inc({ metod: req.method, yol, status: String(res.statusCode) });
        this.davomiylik.observe({ metod: req.method, yol }, s);
      });
      keyingi();
    };
  }

  /** GET /metrics (Prometheus text format) */
  handler(token: string | undefined) {
    return async (req: Request, res: Response): Promise<void> => {
      if (token !== undefined && req.get("authorization") !== `Bearer ${token}`) { res.status(401).type("text/plain").send("401\n"); return; }
      res.type(this.reestr.contentType).send(await this.reestr.metrics());
    };
  }
}
