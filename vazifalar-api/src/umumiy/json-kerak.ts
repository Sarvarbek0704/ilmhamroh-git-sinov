// json-kerak.ts — tanali so'rov faqat JSON bo'lsin (415)
import type { Request } from "express";
import { IlovaXatosi } from "./xatolar.ts";

// Express 5: Content-Type JSON bo'lmasa express.json() tanani o'qimaydi va req.body = undefined — xato YO'Q.
// Shuning uchun turini o'zimiz tekshiramiz (req.is: JSON — "application/json", boshqa — false, tana yo'q — null)
// JSON Merge Patch (RFC 7396) o'z media turiga ega — PATCH uchun ikkalasi ham qabul qilinadi
export const JSON_TURLARI = ["application/json", "application/merge-patch+json"];

/** Holat 06: handler boshida chaqiriladi (Express'da route middleware edi; Nest'da route darajasidagi middleware yo'q — #22 da guard) */
export function jsonTanaKerak(req: Request): void {
  const tur = req.is(JSON_TURLARI);
  if (tur === false || tur === null) throw new IlovaXatosi(415, "Content-Type: application/json bo'lishi kerak");
}
