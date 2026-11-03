// qoriqchi.ts — #39 NS-39 (B bosqich): GLOBAL auth guard. Sukut — HAMMA marshrut himoyalangan ("yopiq sukut"): yangi controller qo'shib,
// himoyani unutish mumkin emas. Ochiqlari aniq belgilanadi: @Ochiq(). Qo'shimcha talablar: @SessiyaKerak() (API kaliti emas, aynan brauzer sessiyasi),
// @Rollar("admin") (RBAC, rol bazadan — sessiya tekshiruvida). 28-qism middleware.ts dagi kirishKerak / rolKerak shu guard'ga ko'chdi.
// Kim ekanini aniqlash (cookie, Bearer) — guard'dan OLDIN, Express middleware'ida (kimlik(), ilova.ts): idempotentlik middleware'i ham egasini bilsin.
import { Inject, Injectable, SetMetadata } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IlovaXatosi } from "../umumiy/xatolar.ts";
import { KirilmaganXatosi } from "./middleware.ts";
import type { Ruxsat } from "./api-kalit.ts";
import { AUTH } from "../tokenlar.ts";
import type { AuthBogliqliklari } from "./xizmat.ts";
import type { NestQoida } from "./cheklov.guard.ts";

export type Rol = "foydalanuvchi" | "admin";

const OCHIQ = "auth:ochiq";
const SESSIYA = "auth:sessiya";
const ROLLAR = "auth:rollar";

/** Kirishsiz ochiq (ro'yxat, login, OIDC qaytishi, health, docs). Klass yoki metodga */
export const Ochiq = (): MethodDecorator & ClassDecorator => SetMetadata(OCHIQ, true);
/** Faqat brauzer sessiyasi (API kaliti bilan EMAS): profil, sessiyalar, API kalitlarni boshqarish, 2FA, passkey ro'yxati */
export const SessiyaKerak = (): MethodDecorator & ClassDecorator => SetMetadata(SESSIYA, true);
/** Rol talabi (sessiya + rol): 401 — kim ekani noma'lum, 403 — ruxsati yo'q */
export const Rollar = (...rollar: Rol[]): MethodDecorator & ClassDecorator => SetMetadata(ROLLAR, rollar);

export class RuxsatYoqXatosi extends IlovaXatosi {
  constructor() {
    super(403, "Bu amal uchun ruxsatingiz yo'q", { kod: "ruxsat-yoq", sarlavha: "Ruxsat yo'q" });
  }
}

const OQISH = new Set(["GET", "HEAD"]);

@Injectable()
export class KirishGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(AUTH) private readonly auth: AuthBogliqliklari | null) {}

  canActivate(kontekst: ExecutionContext): boolean {
    const req = kontekst.switchToHttp().getRequest<Request>();
    const nishon = [kontekst.getHandler(), kontekst.getClass()];
    const rollar = this.reflector.getAllAndOverride<Rol[] | undefined>(ROLLAR, nishon);
    const sessiyaKerak = rollar !== undefined || this.reflector.getAllAndOverride<boolean | undefined>(SESSIYA, nishon) === true;
    // metod darajasidagi talab (SessiyaKerak/Rollar) klass darajasidagi @Ochiq dan kuchli
    if (!sessiyaKerak && this.reflector.getAllAndOverride<boolean | undefined>(OCHIQ, nishon) === true) return true;
    // DEV rejim (auth yo'q, xotira/fayl ombori): egasi — config EGASI_ID (ilova.ts middleware'i qo'ygan)
    if (this.auth === null) return true;
    if (sessiyaKerak) {
      if (req.sessiya === undefined || req.apiKalit !== undefined) throw new KirilmaganXatosi();
      if (rollar !== undefined && !rollar.includes(req.sessiya.rol)) throw new RuxsatYoqXatosi();
      return true;
    }
    // Ma'lumot yo'llari: sessiya YOKI API kaliti (ruxsati bilan: GET/HEAD — vazifalar:oqish, qolgani — vazifalar:yozish)
    if (req.apiKalit !== undefined) {
      const kerak: Ruxsat = OQISH.has(req.method) ? "vazifalar:oqish" : "vazifalar:yozish";
      if (!req.apiKalit.ruxsatlar.includes(kerak)) throw new IlovaXatosi(403, `Kalitda "${kerak}" ruxsati yo'q`, { kod: "ruxsat-yoq", sarlavha: "Ruxsat yo'q" });
      return true;
    }
    if (req.sessiya === undefined) throw new KirilmaganXatosi();
    return true;
  }
}

/** #26 (28): ma'lumot yo'llari — foydalanuvchi (yoki API kaliti egasi) bo'yicha daqiqasiga 600 so'rov. DEV rejimda (auth yo'q) cheklov yo'q */
export const API_CHEKLOVI: NestQoida = { nom: "api", limit: 600, oynaMs: 60_000, kalit: (req) => (req.egasi === undefined ? undefined : String(req.egasi)) };
