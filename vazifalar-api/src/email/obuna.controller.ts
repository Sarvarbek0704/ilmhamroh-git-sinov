// obuna.controller.ts — 30 C (29-qism B holat 13 `obunaRouteri` ning Nest shakli): one-click obunadan chiqish (RFC 8058), sessiyasiz (@Ochiq).
//   GET  /v1/obuna/:token — faqat tasdiqlash sahifasi (pochta skanerlari havolani oldindan ochadi — GET hech narsani o'zgartirmaydi)
//   POST /v1/obuna/:token — "List-Unsubscribe=One-Click" (urlencoded — ilova.ts da shu yo'l uchun parser) → sozlamalar.bildirishnoma.<kanal> = false
// Pochta provayderi cookie'siz yuboradi — CSRF tekshiruvi (faqat cookie bor so'rovda) tegmaydi. Pool — foydalanuvchilar jadvaliga yoza oladigan (auth).
// Nest farqi: HTML/matn javob — @Header("Content-Type") bilan; global helmet CSP (default-src 'none') sahifadagi inline style'ni ham to'sadi — 29 da ham shunday
// (forma uslubsiz ham ishlaydi; form-action 'none' esa POST'ni to'sardi — sahifa uchun CSP alohida, pastda).
import { Controller, Get, Header, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { TopilmadiXatosi } from "../umumiy/xatolar.ts";
import { Ochiq } from "../auth/qoriqchi.ts";
import { AUTH, OBUNA_KALITI } from "../tokenlar.ts";
import type { AuthBogliqliklari } from "../auth/xizmat.ts";
import { obunaTokeniniOch } from "./obuna.ts";

const SAHIFA = `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Obunani bekor qilish</title></head>
<body style="font-family:Arial,sans-serif;max-width:480px;margin:48px auto;padding:0 16px"><h1 style="font-size:20px">Email eslatmalarini o'chirasizmi?</h1>
<form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit" style="padding:10px 20px;font-size:16px">Ha, o'chirish</button></form></body></html>`;

@Controller("obuna")
@Ochiq()
export class ObunaController {
  constructor(@Inject(OBUNA_KALITI) private readonly kalit: Buffer, @Inject(AUTH) private readonly auth: AuthBogliqliklari) {}

  #och(token: string) {
    const t = obunaTokeniniOch(this.kalit, token);
    if (t === undefined) throw new TopilmadiXatosi("Havola yaroqsiz", "obuna-havolasi");
    return t;
  }

  @Get(":token")
  @Header("Content-Type", "text/html; charset=utf-8")
  // sahifa o'z formasini yubora olsin (API'ning qat'iy CSP'si form-action 'none'); inline uslub — faqat shu sahifa
  @Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
  sahifa(@Param("token") token: string): string {
    this.#och(token);
    return SAHIFA;
  }

  @Post(":token")
  @HttpCode(200)
  @Header("Content-Type", "text/plain; charset=utf-8")
  async bekor(@Param("token") token: string): Promise<string> {
    const t = this.#och(token);
    const q = await this.auth.pool.query(
      `UPDATE foydalanuvchilar
          SET sozlamalar = jsonb_set(sozlamalar, '{bildirishnoma}', coalesce(sozlamalar->'bildirishnoma', '{}'::jsonb) || jsonb_build_object($2::text, false))
        WHERE id = $1`,
      [t.fId, t.kanal],
    );
    if (q.rowCount === 0) throw new TopilmadiXatosi("Havola yaroqsiz", "obuna-havolasi");
    return "Obuna bekor qilindi. Sozlamalardan qayta yoqishingiz mumkin.";
  }
}
