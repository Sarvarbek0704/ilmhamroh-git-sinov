// oidc.ts — #15 B-119 (holat 15): "Google bilan kirish" — OpenID Connect, Authorization Code + PKCE (openid-client 6). Provayder umumiy: issuer + client.
// Haqiqiy Google — faqat hujjat bo'yicha sozlash (Google Cloud Console, redirect URI); kanon testlari LOKAL oidc-provider bilan (test/oidc.test.ts) —
// Google hisobi va kalitlari ishlatilmagan (SINALMAGAN).
// Oqim holati (state, nonce, PKCE verifier) — qisqa muddatli IMZOLANGAN cookie'da (HMAC, ILOVA_SIRI dan HKDF kaliti): server xotirasi/baza kerak emas,
// state brauzerga bog'langan (login CSRF — t14: "state mos emas" → rad). SameSite=Lax: provayderdan qaytish — yuqori darajadagi GET, cookie yuboriladi.
import { createHmac, timingSafeEqual } from "node:crypto";
import * as client from "openid-client";
import type { Request, Response } from "express";
import { IlovaXatosi } from "../umumiy/xatolar.ts";

export type OidcSozlama = {
  /** URL yo'lidagi nom: /v1/auth/oidc/<nom> */
  nom: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** API'ning tashqi manzili + yo'l — provayderda ro'yxatdan o'tgan redirect URI bilan AYNAN bir xil */
  qaytishUrl: string;
  /** faqat test/dev: http issuer (lokal soxta provayder) */
  httpRuxsat?: boolean;
};

export type TashqiKimlik = { provayder: string; subyekt: string; email?: string | undefined; emailTasdiqlangan: boolean; ism?: string | undefined };

const MUDDAT_MS = 10 * 60_000;
type Holat = { p: string; s: string; n: string; v: string; e: number };

export class OidcXatosi extends IlovaXatosi {
  constructor(sabab: string) {
    super(400, `Tashqi kirish muvaffaqiyatsiz: ${sabab}`, { kod: "oidc-xato", sarlavha: "Tashqi kirish muvaffaqiyatsiz" });
  }
}

export class Oidc {
  readonly s: OidcSozlama;
  readonly #kalit: Buffer;
  readonly #secure: boolean;
  #config: Promise<client.Configuration> | undefined;

  constructor(s: OidcSozlama, kalit: Buffer, secure: boolean) {
    this.s = s;
    this.#kalit = kalit;
    this.#secure = secure;
  }

  get cookieNomi(): string {
    return this.#secure ? "__Host-oidc" : "oidc";
  }

  /** Discovery (/.well-known/openid-configuration) — birinchi kerak bo'lganda, keyin keshda; xatoda keyingi urinish qaytadan */
  #sozlama(): Promise<client.Configuration> {
    this.#config ??= client.discovery(new URL(this.s.issuer), this.s.clientId, this.s.clientSecret, undefined,
      // openid-client buni ataylab "deprecated" deb belgilagan (ko'zga tashlansin) — faqat lokal http soxta provayder uchun (OIDC_HTTP, test/dev)
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      this.s.httpRuxsat === true ? { execute: [client.allowInsecureRequests] } : undefined).catch((x: unknown) => {
      this.#config = undefined;
      throw x;
    });
    return this.#config;
  }

  #imzola(h: Holat): string {
    const t = Buffer.from(JSON.stringify(h)).toString("base64url");
    return `${t}.${createHmac("sha256", this.#kalit).update(t).digest("base64url")}`;
  }

  #och(qiymat: string | undefined): Holat | undefined {
    if (qiymat === undefined || qiymat.length > 2000) return undefined;
    const [t, imzo] = qiymat.split(".");
    if (t === undefined || imzo === undefined) return undefined;
    const kutilgan = createHmac("sha256", this.#kalit).update(t).digest();
    const berilgan = Buffer.from(imzo, "base64url");
    if (berilgan.length !== kutilgan.length || !timingSafeEqual(berilgan, kutilgan)) return undefined;
    const h = JSON.parse(Buffer.from(t, "base64url").toString("utf8")) as Holat;
    return h.p === this.s.nom && h.e > Date.now() ? h : undefined;
  }

  /** Provayderga yo'naltirish URL'i + holat cookie'si */
  async boshla(res: Response): Promise<URL> {
    const config = await this.#sozlama();
    const v = client.randomPKCECodeVerifier();
    const h: Holat = { p: this.s.nom, s: client.randomState(), n: client.randomNonce(), v, e: Date.now() + MUDDAT_MS };
    res.cookie(this.cookieNomi, this.#imzola(h), { httpOnly: true, secure: this.#secure, sameSite: "lax", path: "/", maxAge: MUDDAT_MS });
    return client.buildAuthorizationUrl(config, {
      redirect_uri: this.s.qaytishUrl, scope: "openid email profile", state: h.s, nonce: h.n,
      code_challenge: await client.calculatePKCECodeChallenge(v), code_challenge_method: "S256",
    });
  }

  /** Qaytish: cookie (imzo, muddat) → kod + PKCE bilan token → id_token tekshiruvi (iss, aud, exp, nonce — openid-client) → kimlik */
  async yakunla(req: Request, res: Response, cookie: string | undefined): Promise<TashqiKimlik> {
    const h = this.#och(cookie);
    res.clearCookie(this.cookieNomi, { httpOnly: true, secure: this.#secure, sameSite: "lax", path: "/" });
    if (h === undefined) throw new OidcXatosi("holat cookie'si yo'q, buzilgan yoki eskirgan");
    const config = await this.#sozlama();
    const joriy = new URL(req.originalUrl, this.s.qaytishUrl); // redirect_uri bilan bir xil asos (proxy orqasida ham)
    let t: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;
    try {
      t = await client.authorizationCodeGrant(config, joriy, { pkceCodeVerifier: h.v, expectedState: h.s, expectedNonce: h.n, idTokenExpected: true });
    } catch (x) {
      throw new OidcXatosi(x instanceof client.ResponseBodyError ? x.error : x instanceof Error ? x.message.slice(0, 100) : "token");
    }
    const c = t.claims();
    if (c === undefined) throw new OidcXatosi("id_token yo'q");
    // t14 topilmasi: ba'zi provayderlar email'ni id_token'ga qo'ymaydi (access token bilan userinfo'da beradi) — Google qo'yadi
    const u = c["email"] === undefined ? await client.fetchUserInfo(config, t.access_token, c.sub) : c;
    const email = typeof u["email"] === "string" ? u["email"].toLowerCase() : undefined;
    // 30 B BACKLOG 3: ba'zi provayderlar (eski Google userinfo, Cognito, ba'zi Azure AD) email_verified'ni SATR ("true") qilib beradi — OIDC Core
    // boolean deydi, lekin amalda satr ham uchraydi. Faqat aniq true / "true" — tasdiqlangan; "false", "1", "yes" va boshqasi — YO'Q (xavfsiz tomonga)
    const tasdiq = u["email_verified"];
    return { provayder: this.s.nom, subyekt: c.sub, email, emailTasdiqlangan: tasdiq === true || tasdiq === "true", ism: typeof u["name"] === "string" ? u["name"] : undefined };
  }
}
