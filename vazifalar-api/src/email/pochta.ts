// pochta.ts — tranzaksion email: Nodemailer transporter (SMTP), Handlebars shablon (HTML + matn versiya), List-Unsubscribe, DKIM (B-147…B-149).
// Lokal: Mailpit (SMTP catcher) — xat hech qayerga ketmaydi. Prodda — provayder SMTP'si (Resend, SES, Postmark, Brevo …) — SINALMAGAN.
import nodemailer, { type Transporter } from "nodemailer";
import Handlebars from "handlebars";

export type PochtaSozlama = {
  host: string;
  port: number;
  /** true — 465 (implicit TLS); false — 587 (STARTTLS, `requireTLS` bilan) yoki lokal 1025 */
  secure: boolean;
  requireTLS?: boolean;
  user?: string;
  pass?: string;
  from: string;
  dkim?: { domainName: string; keySelector: string; privateKey: string };
};

export type Shablon = { mavzu: string; html: string; matn: string };

/** Handlebars: `{{x}}` HTML-ekranlanadi, `{{{x}}}` — yo'q (foydalanuvchi ma'lumoti uchun ISHLATILMAYDI). `strict` — yo'q o'zgaruvchi xato. */
export function shablonKompilyatsiya(s: Shablon): (data: Record<string, unknown>) => Shablon {
  const opt = { strict: true, noEscape: false };
  const mavzu = Handlebars.compile(s.mavzu, { ...opt, noEscape: true }); // mavzu — matn, HTML emas; CRLF ni nodemailer o'zi tozalaydi
  const html = Handlebars.compile(s.html, opt);
  const matn = Handlebars.compile(s.matn, { ...opt, noEscape: true });
  return (d) => ({ mavzu: mavzu(d), html: html(d), matn: matn(d) });
}

export const SHABLONLAR = {
  // 29-qism B (holat 13): muddat — o'zgaruvchi. A dagi "30 daqiqa" 28 dagi email_tasdiq tokeniga (24 soat) mos emas edi
  tasdiqlash: {
    mavzu: "Emailingizni tasdiqlang — vazifalar",
    html: `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"></head>
<body style="margin:0;background:#f4f4f7"><div style="display:none;max-height:0;overflow:hidden">Havola {{muddat}} amal qiladi</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;font-family:Arial,sans-serif;color:#141726">
<tr><td style="padding:32px"><h1 style="margin:0 0 16px;font-size:22px">Salom, {{ism}}!</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:24px">Hisobingizni tasdiqlash uchun tugmani bosing.</p>
<a href="{{havola}}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:16px">Tasdiqlash</a>
<p style="margin:24px 0 0;font-size:13px;color:#555">Tugma ishlamasa: {{havola}}</p></td></tr></table></td></tr></table></body></html>`,
    matn: "Salom, {{ism}}!\n\nHisobingizni tasdiqlash uchun havolani oching ({{muddat}} amal qiladi):\n{{havola}}\n\nSiz so'ramagan bo'lsangiz — bu xatni e'tiborsiz qoldiring.\n",
  },
  // 29-qism B (holat 13): 28 dagi parol tiklash oqimi uchun (havola — bir martalik, 30 daqiqa)
  tiklash: {
    mavzu: "Parolni tiklash — vazifalar",
    html: `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"></head>
<body style="margin:0;background:#f4f4f7"><div style="display:none;max-height:0;overflow:hidden">Havola {{muddat}} va bir marta amal qiladi</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;font-family:Arial,sans-serif;color:#141726">
<tr><td style="padding:32px"><h1 style="margin:0 0 16px;font-size:22px">Parolni tiklash</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:24px">Yangi parol o'rnatish uchun tugmani bosing. Siz so'ramagan bo'lsangiz — hech narsa qilmang, parolingiz o'zgarmaydi.</p>
<a href="{{havola}}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:16px">Parol o'rnatish</a>
<p style="margin:24px 0 0;font-size:13px;color:#555">Tugma ishlamasa: {{havola}}</p></td></tr></table></td></tr></table></body></html>`,
    matn: "Parolni tiklash so'raldi. Yangi parol o'rnatish uchun havola ({{muddat}}, bir marta):\n{{havola}}\n\nSiz so'ramagan bo'lsangiz — hech narsa qilmang, parolingiz o'zgarmaydi.\n",
  },
  // 29-qism B (holat 18): bildirishnoma markazining email kanali — har qanday tur (sarlavha, matn, ilova ichidagi havola) + obunadan chiqish
  bildirishnoma: {
    mavzu: "{{sarlavha}}",
    html: `<!doctype html><html lang="uz"><head><meta charset="utf-8"></head><body style="margin:0;background:#f4f4f7;font-family:Arial,sans-serif;color:#141726">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px"><tr><td style="padding:32px">
<h1 style="margin:0 0 12px;font-size:20px">{{sarlavha}}</h1><p style="margin:0 0 24px;font-size:16px;line-height:24px">{{matn}}</p>
<a href="{{havola}}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px">Ochish</a>
<p style="margin:24px 0 0;font-size:12px;color:#777"><a href="{{obunaBekor}}" style="color:#777">Email bildirishnomalarini o'chirish</a></p></td></tr></table></td></tr></table></body></html>`,
    matn: "{{sarlavha}}\n\n{{matn}}\n{{havola}}\n\nEmail bildirishnomalarini o'chirish: {{obunaBekor}}\n",
  },
  eslatma: {
    mavzu: "Eslatma: {{matn}}",
    html: `<!doctype html><html lang="uz"><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif">
<p>Vazifa muddati yaqin: <strong>{{matn}}</strong> — {{muddat}}.</p>
<p style="font-size:12px;color:#777"><a href="{{obunaBekor}}">Eslatmalarni o'chirish</a></p></body></html>`,
    matn: "Vazifa muddati yaqin: {{matn}} — {{muddat}}.\n\nEslatmalarni o'chirish: {{obunaBekor}}\n",
  },
} as const satisfies Record<string, Shablon>;

export class Pochta {
  readonly t: Transporter;
  readonly from: string;
  constructor(s: PochtaSozlama) {
    this.from = s.from;
    this.t = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      ...(s.requireTLS === undefined ? {} : { requireTLS: s.requireTLS }),
      ...(s.user && s.pass ? { auth: { user: s.user, pass: s.pass } } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      ...(s.dkim ? { dkim: s.dkim } : {}),
    });
  }

  /** Ishga tushishda: ulanish va auth to'g'rimi (xat yubormaydi). */
  async tekshir(): Promise<void> {
    await this.t.verify();
  }

  /**
   * Yuboradi. `obunaBekor` berilsa (marketing/eslatma) — RFC 2369 `List-Unsubscribe` va RFC 8058 one-click (`List-Unsubscribe-Post`).
   * `idempotentlikKaliti` → `Message-ID` (qayta urinishda bir xil ID — qabul qiluvchi tomonda takrorni aniqlash mumkin).
   */
  async yubor(x: { kimga: string; xat: Shablon; obunaBekor?: string; idempotentlikKaliti?: string; ilovalar?: { filename: string; content: Buffer; contentType: string }[] }): Promise<{ messageId: string; qabul: string[]; rad: string[] }> {
    const domen = this.from.replace(/^.*@/, "").replace(/>.*$/, "");
    const r = (await this.t.sendMail({
      from: this.from,
      to: x.kimga,
      subject: x.xat.mavzu,
      html: x.xat.html,
      text: x.xat.matn,
      ...(x.idempotentlikKaliti ? { messageId: `<${x.idempotentlikKaliti}@${domen}>` } : {}),
      ...(x.obunaBekor
        ? { list: { unsubscribe: { url: x.obunaBekor, comment: "Obunani bekor qilish" } }, headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }
        : {}),
      ...(x.ilovalar ? { attachments: x.ilovalar } : {}),
    })) as { messageId: string; accepted: (string | { address: string })[]; rejected: (string | { address: string })[] };
    const manzil = (a: string | { address: string }) => (typeof a === "string" ? a : a.address);
    return { messageId: r.messageId, qabul: r.accepted.map(manzil), rad: r.rejected.map(manzil) };
  }

  yop(): void {
    this.t.close();
  }
}
