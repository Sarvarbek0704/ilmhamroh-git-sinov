// yol.ts — resurs to'plamining yo'li (Location, Link uchun). Express'da req.baseUrl ("/v1/vazifalar") router ulangan joyni berardi;
// Nest marshrutlarni ilovaning o'ziga ro'yxatdan o'tkazadi — baseUrl bo'sh. Yo'lni joriy so'rovdan olamiz: versiyali (/v1/vazifalar)
// va eskirgan versiyasiz (/vazifalar) yo'llar ikkalasi to'g'ri ishlaydi
import type { Request } from "express";

/** "/v1/vazifalar/5/x" va "vazifalar" → "/v1/vazifalar" */
export function asosYol(req: Request, toplam: string): string {
  const yol = req.path;
  const i = yol.indexOf(`/${toplam}`);
  return i === -1 ? `/${toplam}` : yol.slice(0, i + toplam.length + 1);
}
