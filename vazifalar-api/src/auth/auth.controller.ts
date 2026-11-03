// auth.controller.ts — /v1/auth (28-qism marshrut.ts ning Nest shakli; biznes qoidalari — xizmat.ts, o'zgarmagan): ro'yxat, email tasdiq, parol tiklash,
// login (+2FA kutish), chiqish, OTP, telefon, OIDC, Telegram, API kalitlar, sessiyalar. Klass — @Ochiq(); sessiya kerak bo'lganlari — @SessiyaKerak().
// Tezlik cheklovlari — @Cheklov (28 dagi qoidalar va sonlar aynan), CAPTCHA — @CaptchaKerak(), tana JSON — @JsonTana().
import { All, Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { z } from "zod";
import { IlovaXatosi, MetodYoqXatosi, TopilmadiXatosi } from "../umumiy/xatolar.ts";
import { JsonTana } from "../umumiy/json-tana.guard.ts";
import { EmailSorovSxemasi, HisobOchirishSxemasi, KirishSxemasi, OtpKirishSxemasi, ParolTiklashSxemasi, RoyxatSxemasi, TelefonSxemasi, TelefonTasdiqSxemasi, TelegramSxemasi, TokenSxemasi } from "./sxema.ts";
import type { Kirish, Royxat } from "./sxema.ts";
import { cookieOl } from "./sessiya.ts";
import { RUXSATLAR } from "./api-kalit.ts";
import { SMS_YUBORILDI, XAT_YUBORILDI } from "./xizmat.ts";
import type { AuthBogliqliklari } from "./xizmat.ts";
import { AuthService, mijoz } from "./auth.service.ts";
import type { Foydalanuvchi } from "./ombor.ts";
import { Ochiq, SessiyaKerak } from "./qoriqchi.ts";
import { parolTekshir } from "./parol.ts";
import { Audit } from "../audit/audit.ts";
import { CaptchaKerak, Cheklov } from "./cheklov.guard.ts";

// #26 tezlik qoidalari (28 bilan bir xil). Login: IP (credential stuffing), hisob+IP (brute force — IP qo'shilgani uchun begona joydan "qulflash" yo'q),
// email bo'yicha kunlik (taqsimlangan hujum) — 30 B: oshganda bloklash EMAS, CAPTCHA (lockout DoS tuzatishi)
const D15 = 15 * 60_000, SOAT = 3_600_000, KUN = 86_400_000;
const ip = (req: Request): string => req.ip ?? "noma'lum";
const emailOl = (req: Request): string | undefined => {
  const e: unknown = (req.body as { email?: unknown } | undefined)?.email;
  return typeof e === "string" ? e.trim().toLowerCase().slice(0, 254) : undefined;
};
const KIRISH = [
  { nom: "kirish-ip", limit: 30, oynaMs: D15, kalit: ip },
  { nom: "kirish-hisob", limit: 5, oynaMs: D15, kalit: (req: Request) => { const e = emailOl(req); return e === undefined ? undefined : `${e}|${ip(req)}`; } },
  { nom: "kirish-email", limit: 50, oynaMs: KUN, kalit: emailOl, oshsa: "captcha" as const },
];
const YUBORISH = { nom: "yuborish-ip", limit: 10, oynaMs: SOAT, kalit: ip };
const TEKSHIRUV = { nom: "tekshiruv-ip", limit: 30, oynaMs: D15, kalit: ip };

const KalitSxemasi = z.strictObject({ nom: z.string().trim().min(1).max(60), ruxsatlar: z.array(z.enum(RUXSATLAR)).min(1).max(2), muddatKun: z.number().int().min(1).max(365).optional() });
const IdSxemasi = z.strictObject({ id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const tgMaydon = (b: Record<string, string | boolean | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(b).filter((x): x is [string, string] => x[0] !== "eslabQol" && typeof x[1] === "string"));

@ApiTags("Auth")
@Controller("auth")
@Ochiq()
export class AuthController {
  readonly #xizmat: AuthService["xizmat"];
  readonly d: AuthBogliqliklari;

  constructor(private readonly auth: AuthService) {
    this.#xizmat = auth.xizmat;
    this.d = auth.d;
  }

  // #12: ro'yxat — har doim 202 va bir xil matn (email band bo'lsa ham); sessiya YO'Q — avval email tasdiqlanadi
  @Post("royxat")
  @HttpCode(202)
  @Cheklov(YUBORISH)
  @CaptchaKerak()
  @JsonTana()
  async royxat(@Body({ schema: RoyxatSxemasi }) body: Royxat, @Req() req: Request): Promise<{ xabar: string }> {
    // #30 honeypot: bot yashirin maydonni to'ldirdi — AYNAN o'sha 202, hech narsa yaratilmaydi, jurnalga
    if (body.vebSayt !== undefined && body.vebSayt !== "") {
      await this.#xizmat.hodisa({ tur: "bot_tutildi", ...mijoz(req), tafsilot: { usul: "honeypot" } });
      return { xabar: XAT_YUBORILDI };
    }
    await this.#xizmat.royxat(body, mijoz(req));
    return { xabar: XAT_YUBORILDI };
  }

  @Post("email-tasdiq")
  @HttpCode(200)
  @Cheklov(TEKSHIRUV)
  @JsonTana()
  async emailTasdiq(@Body({ schema: TokenSxemasi }) body: { token: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<object> {
    const f = await this.#xizmat.emailTasdiqla(body.token, mijoz(req));
    await this.auth.sessiyaBer(req, res, f, false);
    return { foydalanuvchi: f };
  }

  @Post("email-tasdiq/qayta")
  @HttpCode(202)
  @Cheklov(YUBORISH)
  @JsonTana()
  async tasdiqQayta(@Body({ schema: EmailSorovSxemasi }) body: { email: string }, @Req() req: Request): Promise<{ xabar: string }> {
    await this.#xizmat.tasdiqQayta(body.email, mijoz(req));
    return { xabar: XAT_YUBORILDI };
  }

  @Post("parol-tiklash/sorov")
  @HttpCode(202)
  @Cheklov(YUBORISH)
  @CaptchaKerak()
  @JsonTana()
  async tiklashSorovi(@Body({ schema: EmailSorovSxemasi }) body: { email: string }, @Req() req: Request): Promise<{ xabar: string }> {
    await this.#xizmat.tiklashSorovi(body.email, mijoz(req));
    return { xabar: XAT_YUBORILDI };
  }

  /** Yangi parol: hamma sessiyalar bekor (joriy brauzer cookie'si ham o'chiriladi) */
  @Post("parol-tiklash")
  @HttpCode(204)
  @Cheklov(TEKSHIRUV)
  @JsonTana()
  async parolTikla(@Body({ schema: ParolTiklashSxemasi }) body: { token: string; parol: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.#xizmat.parolTikla(body.token, body.parol, mijoz(req));
    this.d.sessiyalar.cookieOchir(res);
  }

  @Post("kirish")
  @HttpCode(200)
  @Cheklov(...KIRISH)
  @JsonTana()
  async kirish(@Body({ schema: KirishSxemasi }) body: Kirish, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<object> {
    const f = await this.#xizmat.kirish(body, mijoz(req));
    await this.d.cheklagich.tozala(`kirish-hisob:${body.email}|${ip(req)}`); // muvaffaqiyat — shu hisob+IP hisobi noldan
    // #19: TOTP yoqilgan — sessiya hali YO'Q; 5 daqiqalik imzolangan cookie va ikkinchi qadam (/2fa/tekshir)
    if (await this.d.mfa.ombor.yoqilganmi(f.id)) {
      this.d.mfa.kutish.qoy(res, { f: f.id, e: body.eslabQol });
      await this.#xizmat.hodisa({ tur: "kirish_mfa_kutilmoqda", foydalanuvchiId: f.id, ...mijoz(req) });
      return { mfa: "kerak" };
    }
    await this.auth.sessiyaBer(req, res, f, body.eslabQol);
    return { foydalanuvchi: f };
  }

  @Get("men")
  @SessiyaKerak()
  men(@Req() req: Request): object {
    const s = req.sessiya;
    if (s === undefined) throw new IlovaXatosi(500, "sessiya yo'q (guard)");
    // 31: rol ham (30-qism ochiq xatosi — frontend admin menyusini ko'rsatishi uchun; avval /v1/admin/* ga urinib 403 olish kerak edi)
    return { foydalanuvchi: { ...s.foydalanuvchi, rol: s.rol }, sessiya: { id: s.id, eslabQol: s.eslabQol, yaratilgan: s.yaratilgan.toISOString(), tugash: s.tugash.toISOString() } };
  }

  /** Chiqish: sessiya bo'lmasa ham 204 (idempotent) — cookie baribir o'chiriladi */
  @Post("chiqish")
  @HttpCode(204)
  async chiqish(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    if (req.sessiya !== undefined) {
      await this.d.sessiyalar.bekorQil(req.sessiya.id);
      await this.#xizmat.hodisa({ tur: "chiqish", foydalanuvchiId: req.sessiya.foydalanuvchi.id, ...mijoz(req) });
    }
    this.d.sessiyalar.cookieOchir(res);
  }

  /** Barcha qurilmalardan chiqish: shu foydalanuvchining hamma sessiyalari, joriysi ham */
  @Post("chiqish-hammasi")
  @HttpCode(200)
  @SessiyaKerak()
  async chiqishHammasi(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ bekorQilindi: number }> {
    const f = this.#sessiya(req);
    const soni = await this.d.sessiyalar.hammasiniBekorQil(f.id);
    await this.#xizmat.hodisa({ tur: "chiqish_hammasi", foydalanuvchiId: f.id, ...mijoz(req), tafsilot: { soni } });
    this.d.sessiyalar.cookieOchir(res);
    return { bekorQilindi: soni };
  }

  /**
   * 31 #11/#12: hisobni o'chirish ("unutilish huquqi", O'RQ-547 17/31-moddalar) — joriy parol bilan qayta tasdiq (o'g'irlangan sessiya bilan hisob o'chirilmasin).
   * sql/302 hisob_anonimlashtir(): shaxsiy ma'lumotlar va FK bilan bog'liq hamma qatorlar o'chadi, id psevdonim (statistika) qoladi; sessiyalar ham o'chadi — cookie o'chiriladi.
   * Parolsiz hisob (faqat Google/Telegram) — 409: avval parol o'rnatiladi (parol tiklash). DB funksiyasini vazifalar_auth roli chaqiradi (GRANT EXECUTE).
   */
  @Delete("men")
  @Audit("hisob.ochirildi", "foydalanuvchi")
  @HttpCode(204)
  @JsonTana()
  @SessiyaKerak()
  async hisobniOchir(@Body({ schema: HisobOchirishSxemasi }) body: { parol: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const f = this.#sessiya(req);
    const hisob = await this.d.ombor.idBilan(f.id);
    if (hisob?.parolHash == null) throw new IlovaXatosi(409, "Hisobda parol yo'q — avval parol o'rnating (parolni tiklash orqali)", { kod: "parol-yoq", sarlavha: "Parol kerak" });
    if (!(await parolTekshir(hisob.parolHash, body.parol)).togri) {
      await this.#xizmat.hodisa({ tur: "hisob_ochirish_rad", foydalanuvchiId: f.id, ...mijoz(req) });
      throw new IlovaXatosi(403, "Parol noto'g'ri", { kod: "parol-notogri", sarlavha: "Parol noto'g'ri" });
    }
    await this.d.pool.query("SELECT hisob_anonimlashtir($1)", [f.id]);
    this.d.sessiyalar.cookieOchir(res);
  }

  // #13: SMS kod bilan kirish (raqam profilda tasdiqlangan bo'lishi kerak)
  @Post("otp/yubor")
  @HttpCode(202)
  @Cheklov(YUBORISH)
  @CaptchaKerak()
  @JsonTana()
  async otpYubor(@Body({ schema: TelefonSxemasi }) body: { telefon: string }, @Req() req: Request): Promise<{ xabar: string }> {
    await this.#xizmat.kodSora("kirish", body.telefon, mijoz(req));
    return { xabar: SMS_YUBORILDI };
  }

  @Post("otp/kirish")
  @HttpCode(200)
  @Cheklov(TEKSHIRUV)
  @JsonTana()
  async otpKirish(@Body({ schema: OtpKirishSxemasi }) body: { telefon: string; kod: string; eslabQol: boolean }, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<object> {
    const f = await this.#xizmat.kodBilanKirish(body.telefon, body.kod, mijoz(req));
    await this.auth.sessiyaBer(req, res, f, body.eslabQol);
    return { foydalanuvchi: f };
  }

  // #13: raqamni hisobga ulash — faqat tizimga kirgan foydalanuvchi, kod shu raqamga
  @Post("telefon")
  @HttpCode(202)
  @SessiyaKerak()
  @Cheklov(YUBORISH)
  @JsonTana()
  async telefon(@Body({ schema: TelefonSxemasi }) body: { telefon: string }, @Req() req: Request): Promise<{ xabar: string }> {
    await this.#xizmat.kodSora("telefon_ulash", body.telefon, mijoz(req), this.#sessiya(req).id);
    return { xabar: "SMS kod yuborildi (raqam boshqa hisobga ulangan bo'lmasa)" };
  }

  @Post("telefon/tasdiq")
  @HttpCode(200)
  @SessiyaKerak()
  @JsonTana()
  async telefonTasdiq(@Body({ schema: TelefonTasdiqSxemasi }) body: { telefon: string; kod: string }, @Req() req: Request): Promise<{ telefon: unknown }> {
    return { telefon: await this.#xizmat.telefonTasdiqla(this.#sessiya(req).id, body.telefon, body.kod, mijoz(req)) };
  }

  // #15: tashqi kirish (OIDC). Brauzer navigatsiyasi — JSON emas: muvaffaqiyat/xato bilan frontend'ga 303 (xato kodi query'da, tafsilot — jurnalda)
  @Get("oidc/:provayder")
  async oidcBoshla(@Param("provayder") nom: string, @Res() res: Response): Promise<void> {
    const p = this.d.oidc.get(nom);
    if (p === undefined) throw new TopilmadiXatosi("Bunday provayder sozlanmagan", "provayder-yoq", "Provayder yo'q");
    res.redirect(303, (await p.boshla(res)).href);
  }

  @Get("oidc/:provayder/qaytish")
  async oidcQaytish(@Param("provayder") nom: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const p = this.d.oidc.get(nom);
    if (p === undefined) throw new TopilmadiXatosi("Bunday provayder sozlanmagan", "provayder-yoq", "Provayder yo'q");
    try {
      const k = await p.yakunla(req, res, cookieOl(req.headers.cookie, p.cookieNomi));
      const f = await this.#xizmat.tashqiKirish(k, mijoz(req));
      await this.auth.sessiyaBer(req, res, f, true);
      res.redirect(303, `${this.d.ilovaUrl}/`);
    } catch (x) {
      if (!(x instanceof IlovaXatosi)) throw x;
      res.redirect(303, `${this.d.ilovaUrl}/kirish?xato=${encodeURIComponent(x.kod ?? "xato")}`);
    }
  }

  // #16: Telegram Login Widget — kirish (ulangan hisob) va ulash (tizimga kirgan foydalanuvchi)
  @Post("telegram")
  @HttpCode(200)
  @Cheklov(TEKSHIRUV)
  @JsonTana()
  async telegram(@Body({ schema: TelegramSxemasi }) body: Record<string, string | boolean | undefined> & { eslabQol: boolean }, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<object> {
    const f = await this.#xizmat.telegramKirish(tgMaydon(body), mijoz(req));
    await this.auth.sessiyaBer(req, res, f, body.eslabQol);
    return { foydalanuvchi: f };
  }

  @Post("telegram/ulash")
  @HttpCode(204)
  @SessiyaKerak()
  @Cheklov(TEKSHIRUV)
  @JsonTana()
  async telegramUlash(@Body({ schema: TelegramSxemasi }) body: Record<string, string | boolean | undefined>, @Req() req: Request): Promise<void> {
    await this.#xizmat.telegramUlash(this.#sessiya(req).id, tgMaydon(body), mijoz(req));
  }

  // #22: API kalitlari — FAQAT sessiya bilan boshqariladi (kalit o'zini yoki boshqa kalitni yarata olmaydi)
  @Get("api-kalitlar")
  @SessiyaKerak()
  async kalitlar(@Req() req: Request): Promise<object> {
    return { kalitlar: await this.d.apiKalitlar.royxat(this.#sessiya(req).id) };
  }

  @Post("api-kalitlar")
  @Audit("api_kalit.yaratildi", "api_kalit")
  @SessiyaKerak()
  @JsonTana()
  async kalitYarat(@Body({ schema: KalitSxemasi }) body: z.output<typeof KalitSxemasi>, @Req() req: Request): Promise<object> {
    const f = this.#sessiya(req);
    const k = await this.d.apiKalitlar.yarat(f.id, body.nom, [...new Set(body.ruxsatlar)], body.muddatKun);
    await this.#xizmat.hodisa({ tur: "api_kalit_yaratildi", foydalanuvchiId: f.id, ...mijoz(req), tafsilot: { prefiks: k.prefiks } });
    return { ...k, ogohlantirish: "Kalit faqat hozir ko'rsatiladi — xavfsiz joyga saqlang" };
  }

  @Delete("api-kalitlar/:id")
  @Audit("api_kalit.bekor", "api_kalit")
  @HttpCode(204)
  @SessiyaKerak()
  async kalitBekor(@Param({ schema: IdSxemasi }) { id }: { id: number }, @Req() req: Request): Promise<void> {
    const f = this.#sessiya(req);
    if (!(await this.d.apiKalitlar.bekor(f.id, id))) throw new TopilmadiXatosi("Kalit topilmadi", "kalit-topilmadi", "Kalit topilmadi");
    await this.#xizmat.hodisa({ tur: "api_kalit_bekor", foydalanuvchiId: f.id, ...mijoz(req), tafsilot: { id } });
  }

  @Post("api-kalitlar/:id/aylantirish")
  @SessiyaKerak()
  async kalitAylantir(@Param({ schema: IdSxemasi }) { id }: { id: number }, @Req() req: Request): Promise<object> {
    const f = this.#sessiya(req);
    const k = await this.d.apiKalitlar.aylantir(f.id, id);
    if (k === undefined) throw new TopilmadiXatosi("Kalit topilmadi", "kalit-topilmadi", "Kalit topilmadi");
    await this.#xizmat.hodisa({ tur: "api_kalit_yaratildi", foydalanuvchiId: f.id, ...mijoz(req), tafsilot: { prefiks: k.prefiks, aylantirildi: id } });
    return { ...k, ogohlantirish: "Eski kalit 24 soatdan keyin ishlamaydi" };
  }

  // #11: qurilmalar ro'yxati va bittasini bekor qilish ("telefonimdan chiqish")
  @Get("sessiyalar")
  @SessiyaKerak()
  async sessiyalar(@Req() req: Request): Promise<object> {
    const s = req.sessiya;
    if (s === undefined) throw new IlovaXatosi(500, "sessiya yo'q (guard)");
    return { sessiyalar: await this.d.sessiyalar.royxat(s.foydalanuvchi.id, s.id) };
  }

  @Delete("sessiyalar/:id")
  @HttpCode(204)
  @SessiyaKerak()
  async sessiyaBekor(@Param({ schema: IdSxemasi }) { id }: { id: number }, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const s = req.sessiya;
    if (s === undefined) throw new IlovaXatosi(500, "sessiya yo'q (guard)");
    // Begona sessiya id — 404 (borligini oshkor qilmaymiz)
    if (!(await this.d.sessiyalar.egasiBekorQilsin(s.foydalanuvchi.id, id))) throw new TopilmadiXatosi("Sessiya topilmadi", "sessiya-topilmadi", "Sessiya topilmadi");
    await this.#xizmat.hodisa({ tur: "sessiya_bekor", foydalanuvchiId: s.foydalanuvchi.id, ...mijoz(req), tafsilot: { sessiyaId: id } });
    if (id === s.id) this.d.sessiyalar.cookieOchir(res);
  }

  // 405: 28 dagi .all(metodYoq(...)) — faqat aniq metodlari bo'lgan yo'llar
  @ApiExcludeEndpoint()
  @All(["royxat", "email-tasdiq", "email-tasdiq/qayta", "parol-tiklash/sorov", "parol-tiklash", "kirish", "chiqish", "chiqish-hammasi", "otp/yubor", "otp/kirish", "telefon", "telefon/tasdiq", "telegram", "telegram/ulash"])
  faqatPost(@Req() req: Request): never {
    throw new MetodYoqXatosi(req.method, "POST");
  }

  @ApiExcludeEndpoint()
  @All(["men", "sessiyalar"])
  faqatGet(@Req() req: Request): never {
    throw new MetodYoqXatosi(req.method, "GET, HEAD");
  }

  @ApiExcludeEndpoint()
  @All("api-kalitlar")
  kalitlarMetodYoq(@Req() req: Request): never {
    throw new MetodYoqXatosi(req.method, "GET, HEAD, POST");
  }

  @ApiExcludeEndpoint()
  @All("sessiyalar/:id")
  sessiyaMetodYoq(@Req() req: Request): never {
    throw new MetodYoqXatosi(req.method, "DELETE");
  }

  #sessiya(req: Request): Foydalanuvchi {
    if (req.sessiya === undefined) throw new IlovaXatosi(500, "sessiya yo'q (guard)");
    return req.sessiya.foydalanuvchi;
  }
}
