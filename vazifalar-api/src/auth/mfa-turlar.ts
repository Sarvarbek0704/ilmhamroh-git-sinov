// mfa-turlar.ts — #19 (28-qism mfa-marshrut.ts dan): 2FA/passkey bog'liqliklari turi va xatosi. Yo'llar — mfa.controller.ts (Nest)
import { IlovaXatosi } from "../umumiy/xatolar.ts";
import type { MfaOmbori } from "./mfa.ts";
import type { ImzoliCookie } from "./imzo-cookie.ts";

export type MfaBogliqliklari = {
  ombor: MfaOmbori;
  /** parol to'g'ri, ikkinchi omil kutilmoqda: foydalanuvchi id va "eslab qol" */
  kutish: ImzoliCookie<{ f: number; e: boolean }>;
  /** WebAuthn challenge (ro'yxat — f bilan, kirish — f'siz) */
  chaqiriq: ImzoliCookie<{ ch: string; f?: number }>;
  rpId: string;
  /** brauzer sahifasi origin'lari (frontend) — WebAuthn javobidagi origin shu ro'yxatda bo'lishi shart */
  originlar: string[];
};

export class MfaXatosi extends IlovaXatosi {
  constructor() {
    super(401, "Kod noto'g'ri yoki ishlatilgan", { kod: "mfa-xato", sarlavha: "Ikkinchi omil tasdiqlanmadi" });
  }
}
