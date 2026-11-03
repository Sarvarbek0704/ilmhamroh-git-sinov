// auth.service.ts — AuthController va MfaController umumiy qismi: 28-qism authXizmati (biznes qoidalari) va sessiyaBer (fixation himoyasi, bloklangan hisob).
import { Inject, Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import { IlovaXatosi } from "../umumiy/xatolar.ts";
import { AUTH } from "../tokenlar.ts";
import { cookieNomi, cookieOl } from "./sessiya.ts";
import { authXizmati } from "./xizmat.ts";
import type { AuthBogliqliklari, Mijoz } from "./xizmat.ts";
import type { Foydalanuvchi } from "./ombor.ts";

export function mijoz(req: Request): Mijoz {
  return { ip: req.ip, userAgent: req.get("user-agent") };
}

@Injectable()
export class AuthService {
  readonly xizmat: ReturnType<typeof authXizmati>;

  constructor(@Inject(AUTH) readonly d: AuthBogliqliklari) {
    this.xizmat = authXizmati(d);
  }

  /**
   * Session fixation himoyasi: so'rov bilan kelgan eski cookie (hujumchi oldindan qo'ygan bo'lishi mumkin) bekor qilinadi va HAR DOIM yangi token.
   * #20: bloklangan hisob — HECH QAYSI yo'l (parol, SMS, Google, Telegram, passkey, 2FA) sessiya olmaydi; markaziy tekshiruv shu yerda
   */
  async sessiyaBer(req: Request, res: Response, f: Foydalanuvchi, eslabQol: boolean): Promise<void> {
    if (await this.d.ombor.bloklanganmi(f.id)) {
      await this.xizmat.hodisa({ tur: "bloklangan_kirish", foydalanuvchiId: f.id, ...mijoz(req) });
      throw new IlovaXatosi(403, "Hisob bloklangan — administrator bilan bog'laning", { kod: "hisob-bloklangan", sarlavha: "Hisob bloklangan" });
    }
    const s = this.d.sessiyalar;
    const eski = cookieOl(req.headers.cookie, cookieNomi(s.s));
    if (eski !== undefined) await s.tokenniBekorQil(eski);
    const { token, tugash } = await s.yarat(f.id, mijoz(req), eslabQol);
    s.cookieQoy(res, token, tugash, eslabQol);
  }
}
