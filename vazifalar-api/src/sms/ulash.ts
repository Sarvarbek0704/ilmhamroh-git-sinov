// ulash.ts — 29-qism B (holat 18): SMS provayderi (sms.ts) vazifalar-api ga.
//  1) ProvayderSms — 28 dagi SmsYuboruvchi interfeysi (OTP kodlar) uchun: LogSms/XotiraSms o'rniga haqiqiy provayder (lokal — soxta Eskiz).
//  2) Yetkazish callback'i (30 C: SmsController, bildirishnoma.controller.ts): POST /v1/sms/callback?id=<bizningId> — provayder (Eskiz) imzo qo'ymaydi, shuning uchun bizningId ichida
//     HMAC: "b<bildirishnomaId>.<imzo>". Imzosiz/buzilgan — 404 (provayder qayta urinmasin, hujumchi esa holatni o'zgartira olmasin).
//     Yozish — SECURITY DEFINER funksiya sms_yetkazish_holati (205): API roli yetkazishlar jadvaliga to'g'ridan huquqsiz qoladi.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SmsYuboruvchi } from "../auth/otp.ts";
import type { SmsProvayder } from "./sms.ts";

export class ProvayderSms implements SmsYuboruvchi {
  readonly #p: SmsProvayder;
  constructor(p: SmsProvayder) {
    this.#p = p;
  }
  async yubor(telefon: string, matn: string): Promise<void> {
    await this.#p.yubor(telefon, matn, `otp-${randomUUID()}`);
  }
}

const imzo = (kalit: Buffer, id: number) => createHmac("sha256", kalit).update(`sms:${String(id)}`).digest("base64url").slice(0, 22);

export function smsIdYarat(kalit: Buffer, bildirishnomaId: number): string {
  return `b${String(bildirishnomaId)}.${imzo(kalit, bildirishnomaId)}`;
}

export function smsIdOch(kalit: Buffer, s: string): number | undefined {
  const m = /^b([1-9]\d{0,15})\.([A-Za-z0-9_-]{22})$/.exec(s);
  if (m?.[1] === undefined || m[2] === undefined) return undefined;
  const id = Number(m[1]);
  const a = Buffer.from(m[2]);
  const b = Buffer.from(imzo(kalit, id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : undefined;
}
