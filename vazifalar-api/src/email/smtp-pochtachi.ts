// smtp-pochtachi.ts — 29-qism B (holat 13): 28 dagi Pochtachi interfeysining haqiqiy amalga oshirilishi — Nodemailer (SMTP).
// Lokal: Mailpit (xat hech qayerga ketmaydi). Prodda — provayder SMTP'si (SINALMAGAN). 28 oqimlari (tasdiqlash, tiklash) o'zgarmaydi:
// ular Xat beradi; shablon nomi bo'lsa — HTML + matn Handlebars'dan, bo'lmasa matn versiya va ekranlangan HTML.
import type { Pochtachi, Xat } from "../auth/pochta.ts";
import { Pochta, SHABLONLAR, shablonKompilyatsiya, type Shablon } from "./pochta.ts";

const SHABLON = {
  tasdiqlash: shablonKompilyatsiya(SHABLONLAR.tasdiqlash),
  tiklash: shablonKompilyatsiya(SHABLONLAR.tiklash),
} as const;

const HTML_BELGI: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Shablonsiz xat: matn HTML'ga — ekranlab, qatorlar <br> bilan (foydalanuvchi ismi matnda bo'lishi mumkin) */
export function matndanHtml(matn: string): string {
  const e = matn.replace(/[&<>"']/g, (b) => HTML_BELGI[b] ?? b).replace(/\n/g, "<br>\n");
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;font-size:15px;line-height:22px">${e}</body></html>`;
}

export class SmtpPochtachi implements Pochtachi {
  readonly pochta: Pochta;
  constructor(pochta: Pochta) {
    this.pochta = pochta;
  }

  async yubor(xat: Xat): Promise<void> {
    const s: Shablon = xat.shablon === undefined
      ? { mavzu: xat.mavzu, html: matndanHtml(xat.matn), matn: xat.matn }
      : SHABLON[xat.shablon.nom](xat.shablon.malumot);
    const r = await this.pochta.yubor({ kimga: xat.kimga, xat: s });
    // SMTP 250 bermagan qabul qiluvchi — jim yutilmaydi: fon ishi xatoni log'ga yozadi
    if (r.rad.length > 0) throw new Error(`SMTP qabul qilmadi: ${String(r.rad.length)} ta manzil`);
  }
}
