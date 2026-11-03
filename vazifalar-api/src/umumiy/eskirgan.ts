// eskirgan.ts — eskirgan (deprecated) yo'llar: ishlaydi, lekin har javobda ogohlantirish sarlavhalari
// Deprecation (RFC 9745): qachondan eskirgan (@unix-vaqt); Sunset (RFC 8594): qachon o'chiriladi; Link rel="successor-version"
import type { RequestHandler } from "express";

export type EskiYol = { prefiks: string; voris: string };

export const ESKI_YOLLAR: readonly EskiYol[] = [
  { prefiks: "/vazifalar", voris: "/v1/vazifalar" },
  { prefiks: "/teglar", voris: "/v1/teglar" },
];
/** 2026-10-24 00:00 UTC — /v1 chiqqan kun */
export const ESKIRGAN_VAQT = Date.UTC(2026, 9, 24);
/** 3 oydan keyin o'chiriladi */
export const QUYOSH_BOTISHI = Date.UTC(2027, 0, 24);

export function eskirgan(yollar: readonly EskiYol[]): RequestHandler {
  return (req, res, next) => {
    // req.path EMAS: Nest middleware'ni yo'l bilan ulaganda (consumer.forRoutes("*splat")) Express ulangan qismni kesib tashlaydi —
    // req.path "/" bo'lib qoladi (holat 26 topilmasi). originalUrl — har doim to'liq yo'l
    const yol = req.originalUrl.split("?")[0] ?? "";
    const y = yollar.find((e) => yol === e.prefiks || yol.startsWith(e.prefiks + "/"));
    if (y !== undefined) {
      res.set("Deprecation", `@${String(ESKIRGAN_VAQT / 1000)}`);
      res.set("Sunset", new Date(QUYOSH_BOTISHI).toUTCString());
      res.append("Link", `<${y.voris}${yol.slice(y.prefiks.length)}>; rel="successor-version"`);
    }
    next();
  };
}
