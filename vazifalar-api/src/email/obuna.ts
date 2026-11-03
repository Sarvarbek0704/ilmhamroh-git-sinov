// obuna.ts — 29-qism B (holat 13, #15): one-click obunadan chiqish (RFC 8058). Token — HMAC imzosi (holat serverda saqlanmaydi):
// "<foydalanuvchiId>.<kanal>.<imzo>". Muddatsiz: havola xat qutida yashagancha ishlashi kerak (Gmail/Yahoo talabi — 2 kun ichida bajarish).
// Marshrutlar — obuna.controller.ts (30 C). GET — faqat tasdiqlash sahifasi (pochta skanerlari havolani oldindan ochadi — GET hech narsani o'zgartirmaydi); POST — o'zgartiradi.
import { createHmac, timingSafeEqual } from "node:crypto";

export const OBUNA_KANALLARI = ["email"] as const;
export type ObunaKanali = (typeof OBUNA_KANALLARI)[number];

const imzo = (kalit: Buffer, fId: number, kanal: string) => createHmac("sha256", kalit).update(`obuna:${String(fId)}:${kanal}`).digest("base64url");

export function obunaTokeni(kalit: Buffer, fId: number, kanal: ObunaKanali): string {
  return `${String(fId)}.${kanal}.${imzo(kalit, fId, kanal)}`;
}

export function obunaTokeniniOch(kalit: Buffer, token: string): { fId: number; kanal: ObunaKanali } | undefined {
  const m = /^([1-9]\d{0,15})\.([a-z]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (m === null) return undefined;
  const [, id, kanal, berilgan] = m;
  const k = OBUNA_KANALLARI.find((x) => x === kanal);
  if (id === undefined || k === undefined || berilgan === undefined) return undefined;
  const kutilgan = Buffer.from(imzo(kalit, Number(id), k));
  const b = Buffer.from(berilgan);
  return b.length === kutilgan.length && timingSafeEqual(b, kutilgan) ? { fId: Number(id), kanal: k } : undefined;
}
