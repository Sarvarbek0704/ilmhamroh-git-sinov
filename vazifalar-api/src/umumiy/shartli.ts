// shartli.ts — HTTP kesh va shartli so'rovlar: ETag (versiyadan), If-Match (yo'qolgan yangilanishdan himoya). Cache-Control — controller'da @Header (holat 26)
import type { Request, Response } from "express";
import { ShartXatosi } from "./xatolar.ts";
import type { Shart } from "../vazifalar/ombor.ts";
import type { Vazifa } from "../vazifalar/vazifa.ts";

/** Kuchli ETag: "3" — vazifa versiyasi. Tana xeshi emas: hisoblash arzon, Postgres'da ham shu ustun */
export function etag(v: Vazifa): string {
  return `"${String(v.versiya)}"`;
}

/** Bitta vazifa javobi: ETag + Last-Modified; GET'da Express (fresh) If-None-Match mos kelsa o'zi 304 beradi */
export function vazifaSarlavhalari(res: Response, v: Vazifa): void {
  res.set("ETag", etag(v));
  res.set("Last-Modified", new Date(v.yangilandi).toUTCString());
}

/**
 * If-Match: "3" → { versiya: 3 }; yo'q yoki "*" → undefined (shartsiz).
 * If-Match KUCHLI solishtirish talab qiladi — W/"3" mos kelmaydi (RFC 9110 §13.1.1)
 */
export function ifMatch(req: Request): Shart | undefined {
  const x = req.get("if-match");
  if (x === undefined || x.trim() === "*") return undefined;
  const m = /^\s*"(\d{1,9})"\s*$/.exec(x);
  if (m?.[1] === undefined) {
    throw new ShartXatosi(`If-Match qiymati bu resursga mos emas: ${x.slice(0, 40)}`);
  }
  return { versiya: Number(m[1]) };
}
