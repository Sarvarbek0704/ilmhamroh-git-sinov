// imzo-cookie.ts — #19: qisqa muddatli, HMAC bilan imzolangan cookie (holat serverda saqlanmaydi): 2FA kutilayotgan login, WebAuthn challenge.
// Ichidagini mijoz O'QIY oladi (shifrlanmagan, base64url JSON) — sir saqlanmaydi; o'zgartira OLMAYDI (imzo), muddati ichida (exp).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";
import { cookieOl } from "./sessiya.ts";

export class ImzoliCookie<T extends object> {
  readonly nom: string;
  readonly #kalit: Buffer;
  readonly #muddatMs: number;
  readonly #atr: CookieOptions;

  /** @param asosiyNom masalan "mfa" → secure bo'lsa "__Host-mfa" */
  constructor(asosiyNom: string, kalit: Buffer, muddatMs: number, secure: boolean) {
    this.nom = secure ? `__Host-${asosiyNom}` : asosiyNom;
    this.#kalit = kalit;
    this.#muddatMs = muddatMs;
    this.#atr = { httpOnly: true, secure, sameSite: "lax", path: "/" };
  }

  qoy(res: Response, qiymat: T): void {
    const t = Buffer.from(JSON.stringify({ q: qiymat, e: Date.now() + this.#muddatMs })).toString("base64url");
    res.cookie(this.nom, `${t}.${createHmac("sha256", this.#kalit).update(t).digest("base64url")}`, { ...this.#atr, maxAge: this.#muddatMs });
  }

  ol(req: Request): T | undefined {
    const c = cookieOl(req.headers.cookie, this.nom);
    if (c === undefined || c.length > 4000) return undefined;
    const [t, imzo] = c.split(".");
    if (t === undefined || imzo === undefined) return undefined;
    const kutilgan = createHmac("sha256", this.#kalit).update(t).digest();
    const berilgan = Buffer.from(imzo, "base64url");
    if (berilgan.length !== kutilgan.length || !timingSafeEqual(berilgan, kutilgan)) return undefined;
    const x = JSON.parse(Buffer.from(t, "base64url").toString("utf8")) as { q: T; e: number };
    return x.e > Date.now() ? x.q : undefined;
  }

  ochir(res: Response): void {
    res.clearCookie(this.nom, this.#atr);
  }
}
