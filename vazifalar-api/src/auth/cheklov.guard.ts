// cheklov.guard.ts — #42 NS-42 (B): tezlik cheklovi Nest guard'i sifatida. 28-qism cheklov() Express middleware'ining mantig'i (Postgres hisoblagichlari,
// bir nechta qoida — IP / hisob+IP / email / foydalanuvchi, RateLimit sarlavhalari, 429 + Retry-After, cheklagich xatosida "fail open") — o'zgarmagan;
// qoidalar endi marshrutga dekorator bilan: @Cheklov({ nom, limit, oynaMs, kalit }). Nega guard (middleware emas): MiddlewareConsumer.forRoutes(Controller)
// bir so'rovda middleware'ni bir necha marta chaqiradi (holat 26 topilmasi) — hisoblagich 2 marta oshardi; guard — har handler uchun aniq bir marta.
// @nestjs/throttler bilan solishtiruv — natijalar/tajriba/tB-throttler.txt.
// 30 B BACKLOG 1 (lockout DoS): `kirish-email` qoidasi limitdan oshganda hisobni BLOKLAMAYDI — `oshsa: "captcha"`: CAPTCHA (Turnstile) tokeni
// bo'lsa o'tkazadi. Hujumchi 10 IP'dan 50 urinish qilsa, egasi to'g'ri parol + CAPTCHA bilan kira oladi (28-qismda ~24 soat 429 edi).
import { Inject, Injectable, SetMetadata } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { IlovaXatosi } from "../umumiy/xatolar.ts";
import { CheklovXatosi } from "../umumiy/cheklov.ts";
import type { Natija, Qoida } from "../umumiy/cheklov.ts";
import { AUTH } from "../tokenlar.ts";
import type { AuthBogliqliklari } from "./xizmat.ts";

export type NestQoida = Omit<Qoida, "kalit"> & {
  /** hisob kaliti (IP, email, foydalanuvchi…); undefined — qoida o'tkaziladi. auth — masalan 2FA kutish cookie'sini o'qish uchun */
  kalit: (req: Request, auth: AuthBogliqliklari) => string | undefined;
  /** limitdan oshganda: sukut — 429; "captcha" — to'g'ri X-Captcha bilan o'tkazish (CAPTCHA sozlanmagan bo'lsa — 429) */
  oshsa?: "captcha";
};

const KALIT = "cheklov:qoidalar";
/** Klass (masalan butun ma'lumot controller'i) va metod qoidalari QO'SHILADI (getAllAndMerge) */
export const Cheklov = (...q: NestQoida[]): MethodDecorator & ClassDecorator => SetMetadata(KALIT, q);

export class CaptchaKerakXatosi extends IlovaXatosi {
  constructor() {
    super(400, "Juda ko'p urinish — davom etish uchun CAPTCHA'ni tasdiqlang", { kod: "captcha-kerak", sarlavha: "CAPTCHA kerak" });
  }
}

@Injectable()
export class CheklovGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(AUTH) private readonly auth: AuthBogliqliklari | null) {}

  async canActivate(kontekst: ExecutionContext): Promise<boolean> {
    // DEV rejim (auth yo'q) — 28 dagidek cheklov yo'q
    if (this.auth === null) return true;
    const qoidalar = this.reflector.getAllAndMerge<NestQoida[]>(KALIT, [kontekst.getClass(), kontekst.getHandler()]);
    if (qoidalar.length === 0) return true;
    const req = kontekst.switchToHttp().getRequest<Request>();
    const res = kontekst.switchToHttp().getResponse<Response>();
    const c = this.auth.cheklagich;
    let eng: (Natija & { q: NestQoida }) | undefined;
    try {
      for (const q of qoidalar) {
        const k = q.kalit(req, this.auth);
        if (k === undefined) continue;
        const n = await c.ol(`${q.nom}:${k}`, q.limit, q.oynaMs);
        if (!n.ruxsat && q.oshsa === "captcha" && this.auth.captcha !== undefined) {
          // lockout DoS o'rniga CAPTCHA: token yo'q/noto'g'ri — 400 captcha-kerak (429 EMAS: frontend vidjetni ko'rsatadi); to'g'ri — qoida o'tkaziladi
          const t = await this.auth.captcha.tekshir(req.get("x-captcha"), req.ip);
          if (!t.ok) throw new CaptchaKerakXatosi();
          continue;
        }
        if (eng === undefined || n.qoldi < eng.qoldi || !n.ruxsat) eng = { ...n, q };
        if (!n.ruxsat) break;
      }
    } catch (x) {
      if (x instanceof IlovaXatosi) throw x;
      // Cheklagich (baza) xatosi — so'rov O'TKAZILADI (fail open), jurnalga (28 qarori 6)
      void this.auth.ombor.hodisa({ tur: "cheklov_xato", tafsilot: { xato: x instanceof Error ? x.message.slice(0, 200) : "?" } }).catch(() => undefined);
      return true;
    }
    if (eng !== undefined) {
      res.set("RateLimit-Policy", `${String(eng.q.limit)};w=${String(Math.round(eng.q.oynaMs / 1000))}`);
      res.set("RateLimit", `limit=${String(eng.q.limit)}, remaining=${String(eng.qoldi)}, reset=${String(eng.tiklanishS)}`);
      if (!eng.ruxsat) throw new CheklovXatosi(eng.tiklanishS);
    }
    return true;
  }
}

const CAPTCHA = "auth:captcha";
/** #30: bot hujumi nishoni bo'lgan yo'llar (hisob ochish, xat/SMS yuborish) — X-Captcha (Turnstile) talab qilinadi (CAPTCHA sozlangan bo'lsa) */
export const CaptchaKerak = (): MethodDecorator => SetMetadata(CAPTCHA, true);

@Injectable()
export class CaptchaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(AUTH) private readonly auth: AuthBogliqliklari | null) {}

  async canActivate(kontekst: ExecutionContext): Promise<boolean> {
    if (this.auth?.captcha === undefined || this.reflector.get<boolean | undefined>(CAPTCHA, kontekst.getHandler()) !== true) return true;
    const req = kontekst.switchToHttp().getRequest<Request>();
    const n = await this.auth.captcha.tekshir(req.get("x-captcha"), req.ip);
    if (!n.ok) {
      await this.auth.ombor.hodisa({ tur: "bot_tutildi", ip: req.ip, userAgent: req.get("user-agent"), tafsilot: { usul: "captcha", sabab: n.sabab } });
      throw new IlovaXatosi(400, "CAPTCHA tasdiqlanmadi — sahifani yangilab qayta urinib ko'ring", { kod: "captcha", sarlavha: "CAPTCHA tasdiqlanmadi" });
    }
    return true;
  }
}
