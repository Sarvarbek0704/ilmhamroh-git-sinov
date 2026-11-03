// sorov-id.ts — har so'rovga ID: mijoz (yoki proxy) yuborgan X-Request-Id yoki yangi UUID; javobda qaytariladi
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

// Mijozdan kelgan qiymat — ishonchsiz: faqat qisqa, xavfsiz belgilar (log'ga yoziladi — qator ko'chirish yo'q)
const YAROQLI = /^[\w.-]{8,128}$/;

export function sorovId(yangiId: () => string = randomUUID): RequestHandler {
  return (req, res, next) => {
    const kelgan = req.get("x-request-id");
    req.sorovId = kelgan !== undefined && YAROQLI.test(kelgan) ? kelgan : yangiId();
    res.set("X-Request-Id", req.sorovId);
    next();
  };
}
