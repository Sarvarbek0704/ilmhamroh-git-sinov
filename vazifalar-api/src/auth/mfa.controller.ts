// mfa.controller.ts — #19 (28-qism mfa-marshrut.ts ning Nest shakli): 2FA (TOTP + zaxira kodlar) va passkeys (WebAuthn, @simplewebauthn/server) — /v1/auth.
// Parol bilan kirishda TOTP yoqilgan bo'lsa: /kirish sessiya BERMAYDI — 5 daqiqalik imzolangan "__Host-mfa" cookie + {mfa: "kerak"}; /2fa/tekshir — sessiya.
// Passkey bilan kirish — parol ham, TOTP ham so'ralmaydi (passkey o'zi ikki omil). Challenge — imzolangan cookie'da (bir marta).
import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { z } from "zod";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { IlovaXatosi, KonfliktXatosi } from "../umumiy/xatolar.ts";
import { JsonTana } from "../umumiy/json-tana.guard.ts";
import { otpauthUri } from "./totp.ts";
import type { Foydalanuvchi } from "./ombor.ts";
import { MfaXatosi } from "./mfa-turlar.ts";
import { AuthService, mijoz } from "./auth.service.ts";
import { Ochiq, SessiyaKerak } from "./qoriqchi.ts";
import { Cheklov } from "./cheklov.guard.ts";

const Kod = z.string().max(20);
const KodSxemasi = z.strictObject({ kod: Kod });
const TekshirSxemasi = z.strictObject({ kod: Kod.optional(), zaxiraKod: Kod.optional() });
const JavobSxemasi = z.strictObject({ javob: z.record(z.string(), z.unknown()), nom: z.string().trim().min(1).max(60).optional() });
const D15 = 15 * 60_000;

@ApiTags("Auth")
@Controller("auth")
@Ochiq()
export class MfaController {
  constructor(private readonly auth: AuthService) {}

  get #m() {
    return this.auth.d.mfa;
  }

  #f(req: Request): Foydalanuvchi {
    if (req.sessiya === undefined) throw new IlovaXatosi(500, "sessiya yo'q (guard)");
    return req.sessiya.foydalanuvchi;
  }

  // --- TOTP sozlash ---
  @Post("2fa/sozlash")
  @HttpCode(200)
  @SessiyaKerak()
  async sozlash(@Req() req: Request): Promise<object> {
    const f = this.#f(req);
    const siri = await this.#m.ombor.sozla(f.id);
    if (siri === undefined) throw new KonfliktXatosi("2FA allaqachon yoqilgan — avval o'chiring", { kod: "mfa-yoqilgan", sarlavha: "2FA yoqilgan" });
    // QR kod — frontend'da (otpauth URI'dan); siri faqat shu javobda, keyin hech qachon qaytarilmaydi
    return { otpauth: otpauthUri(siri, f.email), siri: otpauthUri(siri, f.email).split("secret=")[1]?.split("&")[0] };
  }

  @Post("2fa/yoqish")
  @HttpCode(200)
  @SessiyaKerak()
  @JsonTana()
  async yoqish(@Body({ schema: KodSxemasi }) body: { kod: string }, @Req() req: Request): Promise<object> {
    const f = this.#f(req);
    const kodlar = await this.#m.ombor.yoq(f.id, body.kod);
    if (kodlar === undefined) throw new MfaXatosi();
    await this.auth.xizmat.hodisa({ tur: "mfa_yoqildi", foydalanuvchiId: f.id, ...mijoz(req) });
    return { zaxiraKodlar: kodlar };
  }

  @Post("2fa/ochirish")
  @HttpCode(204)
  @SessiyaKerak()
  @JsonTana()
  async ochirish(@Body({ schema: KodSxemasi }) body: { kod: string }, @Req() req: Request): Promise<void> {
    const f = this.#f(req);
    if (!(await this.#m.ombor.totp(f.id, body.kod, true)) && !(await this.#m.ombor.zaxira(f.id, body.kod))) throw new MfaXatosi();
    await this.#m.ombor.ochir(f.id);
    await this.auth.xizmat.hodisa({ tur: "mfa_ochirildi", foydalanuvchiId: f.id, ...mijoz(req) });
  }

  // --- login: ikkinchi qadam. Bitta hisob (mfa cookie'dagi id) — 15 daqiqada 5 urinish ---
  @Post("2fa/tekshir")
  @HttpCode(200)
  @Cheklov({ nom: "2fa", limit: 5, oynaMs: D15, kalit: (req, a) => { const k = a.mfa.kutish.ol(req); return k === undefined ? undefined : String(k.f); } })
  @JsonTana()
  async tekshir(@Body({ schema: TekshirSxemasi }) body: { kod?: string; zaxiraKod?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<object> {
    const k = this.#m.kutish.ol(req);
    if (k === undefined) throw new IlovaXatosi(401, "Avval email va parol bilan kiring (yoki 5 daqiqa o'tdi)", { kod: "mfa-kutilmagan", sarlavha: "Kirish qayta boshlansin" });
    const ok = (body.kod !== undefined && (await this.#m.ombor.totp(k.f, body.kod, true))) || (body.zaxiraKod !== undefined && (await this.#m.ombor.zaxira(k.f, body.zaxiraKod)));
    if (!ok) {
      await this.auth.xizmat.hodisa({ tur: "kirish_xato", foydalanuvchiId: k.f, ...mijoz(req), tafsilot: { sabab: "mfa" } });
      throw new MfaXatosi();
    }
    const h = await this.auth.d.ombor.idBilan(k.f);
    if (h === undefined) throw new MfaXatosi();
    this.#m.kutish.ochir(res);
    await this.auth.xizmat.hodisa({ tur: "kirish", foydalanuvchiId: h.id, ...mijoz(req), tafsilot: { usul: body.kod === undefined ? "zaxira-kod" : "totp", qolganZaxira: await this.#m.ombor.qolganZaxira(h.id) } });
    await this.auth.sessiyaBer(req, res, { id: h.id, email: h.email, toliqIsm: h.toliqIsm }, k.e);
    return { foydalanuvchi: { id: h.id, email: h.email, toliqIsm: h.toliqIsm } };
  }

  // --- passkeys ---
  @Get("passkeylar")
  @SessiyaKerak()
  async passkeylar(@Req() req: Request): Promise<object> {
    return { passkeylar: (await this.#m.ombor.passkeylar(this.#f(req).id)).map((p) => ({ id: p.id, nom: p.nom })) };
  }

  @Post("passkey/royxat/boshla")
  @HttpCode(200)
  @SessiyaKerak()
  async royxatBoshla(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const f = this.#f(req);
    const bor = await this.#m.ombor.passkeylar(f.id);
    const o = await generateRegistrationOptions({
      rpName: "vazifalar", rpID: this.#m.rpId, userName: f.email, userDisplayName: f.toliqIsm, userID: new TextEncoder().encode(`vz-${String(f.id)}`),
      attestationType: "none", excludeCredentials: bor.map((p) => ({ id: p.credentialId })),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    this.#m.chaqiriq.qoy(res, { ch: o.challenge, f: f.id });
    return o;
  }

  @Post("passkey/royxat/yakun")
  @HttpCode(201)
  @SessiyaKerak()
  @JsonTana()
  async royxatYakun(@Body({ schema: JavobSxemasi }) body: z.output<typeof JavobSxemasi>, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const f = this.#f(req);
    const c = this.#m.chaqiriq.ol(req);
    this.#m.chaqiriq.ochir(res); // bir marta
    if (c?.f !== f.id) throw new IlovaXatosi(400, "Challenge yo'q yoki eskirgan", { kod: "webauthn-xato", sarlavha: "Passkey tasdiqlanmadi" });
    const v = await verifyRegistrationResponse({ response: body.javob as unknown as RegistrationResponseJSON, expectedChallenge: c.ch, expectedOrigin: this.#m.originlar, expectedRPID: this.#m.rpId })
      .catch(() => undefined);
    if (v?.verified !== true) throw new IlovaXatosi(400, "Passkey javobi tasdiqlanmadi", { kod: "webauthn-xato", sarlavha: "Passkey tasdiqlanmadi" });
    const cr = v.registrationInfo.credential;
    if (!(await this.#m.ombor.passkeyQosh(f.id, { credentialId: cr.id, ochiqKalit: cr.publicKey, hisoblagich: cr.counter, transports: cr.transports ?? [], nom: body.nom ?? "Passkey" }))) {
      throw new KonfliktXatosi("Bu passkey allaqachon ro'yxatda", { kod: "passkey-bor", sarlavha: "Passkey bor" });
    }
    await this.auth.xizmat.hodisa({ tur: "passkey_qoshildi", foydalanuvchiId: f.id, ...mijoz(req) });
  }

  @Post("passkey/kirish/boshla")
  @HttpCode(200)
  async kirishBoshla(@Res({ passthrough: true }) res: Response): Promise<PublicKeyCredentialRequestOptionsJSON> {
    // allowCredentials yo'q — discoverable (resident) kalit: foydalanuvchi email kiritmaydi
    const o = await generateAuthenticationOptions({ rpID: this.#m.rpId, userVerification: "preferred" });
    this.#m.chaqiriq.qoy(res, { ch: o.challenge });
    return o;
  }

  @Post("passkey/kirish/yakun")
  @HttpCode(200)
  @Cheklov({ nom: "tekshiruv-ip", limit: 30, oynaMs: D15, kalit: (req) => req.ip ?? "noma'lum" })
  @JsonTana()
  async kirishYakun(@Body({ schema: JavobSxemasi }) body: z.output<typeof JavobSxemasi>, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<object> {
    const c = this.#m.chaqiriq.ol(req);
    this.#m.chaqiriq.ochir(res);
    const javob = body.javob as unknown as AuthenticationResponseJSON;
    // javob — tekshirilmagan JSON (TS turi faqat "da'vo"): id satr ekanini ish vaqtida tekshiramiz
    const id: unknown = (body.javob as { id?: unknown }).id;
    const p = c === undefined || typeof id !== "string" || id.length > 1024 ? undefined : await this.#m.ombor.passkeyTop(id);
    const xato = new IlovaXatosi(401, "Passkey tasdiqlanmadi", { kod: "webauthn-xato", sarlavha: "Passkey tasdiqlanmadi" });
    if (c === undefined || p === undefined) throw xato;
    const v = await verifyAuthenticationResponse({
      response: javob, expectedChallenge: c.ch, expectedOrigin: this.#m.originlar, expectedRPID: this.#m.rpId,
      credential: { id: p.credentialId, publicKey: new Uint8Array(p.ochiqKalit), counter: p.hisoblagich },
    }).catch(() => undefined);
    if (v?.verified !== true) {
      await this.auth.xizmat.hodisa({ tur: "kirish_xato", foydalanuvchiId: p.foydalanuvchiId, ...mijoz(req), tafsilot: { sabab: "passkey" } });
      throw xato;
    }
    await this.#m.ombor.passkeyIshlatildi(p.id, v.authenticationInfo.newCounter);
    const h = await this.auth.d.ombor.idBilan(p.foydalanuvchiId);
    if (h === undefined) throw xato;
    await this.auth.xizmat.hodisa({ tur: "kirish", foydalanuvchiId: h.id, ...mijoz(req), tafsilot: { usul: "passkey" } });
    await this.auth.sessiyaBer(req, res, { id: h.id, email: h.email, toliqIsm: h.toliqIsm }, true);
    return { foydalanuvchi: { id: h.id, email: h.email, toliqIsm: h.toliqIsm } };
  }
}
