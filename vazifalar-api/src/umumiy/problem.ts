// problem.ts — Problem Details (RFC 9457, RFC 7807 o'rnini oldi): hamma xato javobi bir xil, mashina o'qiy oladigan shaklda
import { STATUS_CODES } from "node:http";
import type { Response } from "express";
import type { MaydonXatosi } from "./xatolar.ts";

/** Xato turlari katalogi: type URI → tavsif. Yangi kod qo'shilsa — shu yerga (API.md da ham) */
export const XATO_TURI_ASOSI = "https://vazifalar-api.example/xatolar/";

export type Problem = {
  /** URI — xato turi; umumiy HTTP xatolari uchun "about:blank" (title = status matni) */
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** shu holatning manzili — qaysi so'rovda yuz berdi */
  instance?: string;
  /** kengaytmalar (RFC 9457 §3.2): mashina o'qiydigan kod, validatsiya ro'yxati, so'rov ID */
  kod?: string;
  xatolar?: MaydonXatosi[];
  sorovId?: string;
};

/**
 * 31 (30-qism ochiq xatosi: 404 `title` inglizcha edi). RFC 9457 §4.2.1: `about:blank` da title — HTTP holat iborasi, lekin uni MAHALLIYLASHTIRISH mumkin
 * ("MAY be localized"). API foydalanuvchilari — o'zbekcha; mashina `status` va `type` ga qaraydi (title'ga emas).
 */
export const HOLAT_SARLAVHALARI: Readonly<Record<number, string>> = {
  400: "Noto'g'ri so'rov", 401: "Kirish talab qilinadi", 403: "Ruxsat yo'q", 404: "Topilmadi", 405: "Metod ruxsat etilmagan", 406: "Javob formati qo'llanmaydi",
  409: "Ziddiyat", 410: "O'chirilgan", 412: "Shart bajarilmadi", 413: "So'rov juda katta", 415: "Tana formati qo'llanmaydi", 422: "Ma'lumot noto'g'ri",
  428: "Shart talab qilinadi", 429: "So'rovlar juda ko'p", 500: "Ichki xato", 502: "Tashqi xizmat xatosi", 503: "Xizmat vaqtincha mavjud emas", 504: "Tashqi xizmat javob bermadi",
};

export function problemYasa(holat: number, sozlama: { kod?: string | undefined; sarlavha?: string | undefined; detail?: string; instance?: string; xatolar?: MaydonXatosi[] | undefined; sorovId?: string }): Problem {
  const umumiy = HOLAT_SARLAVHALARI[holat] ?? STATUS_CODES[holat] ?? "Xato";
  const p: Problem = {
    type: sozlama.kod === undefined ? "about:blank" : XATO_TURI_ASOSI + sozlama.kod,
    title: sozlama.kod === undefined ? umumiy : (sozlama.sarlavha ?? umumiy),
    status: holat,
  };
  if (sozlama.detail !== undefined) p.detail = sozlama.detail;
  if (sozlama.instance !== undefined) p.instance = sozlama.instance;
  if (sozlama.kod !== undefined) p.kod = sozlama.kod;
  if (sozlama.xatolar !== undefined) p.xatolar = sozlama.xatolar;
  if (sozlama.sorovId !== undefined) p.sorovId = sozlama.sorovId;
  return p;
}

export function problemYubor(res: Response, p: Problem): void {
  // res.json() Content-Type ni application/json qiladi — avval o'zimiz qo'yamiz, json() uni o'zgartirmaydi
  res.status(p.status).type("application/problem+json").json(p);
}
