// xizmat.ts — auth biznes qoidalari: ro'yxat va login (#05), email tasdiqlash va parol tiklash (#12). HTTP'ni bilmaydi (marshrut.ts biladi).
// Login himoyasi: (1) javob bir xil — "email yoki parol noto'g'ri" (user enumeration); (2) vaqt bir xil — email topilmasa ham argon2 (soxtaHash);
// (3) har urinish jurnalga (auth_hodisalar). #12: ro'yxat va parol tiklash so'rovi — email bor-yo'qligidan qat'iy nazar BIR XIL javob (202); natija — faqat xatda.
import { IlovaXatosi, KonfliktXatosi, ValidatsiyaXatosi } from "../umumiy/xatolar.ts";
import { taqiqlanganmi } from "./taqiqlangan-parollar.ts";
import { parolHash, parolTekshir, soxtaHash } from "./parol.ts";
import { EmailBandXatosi } from "./ombor.ts";
import type { AuthOmbori, Foydalanuvchi, Hodisa } from "./ombor.ts";
import type { Kirish, Royxat } from "./sxema.ts";
import type { BirMartalikTokenlar, Maqsad } from "./token.ts";
import type { Pochtachi } from "./pochta.ts";
import type { SessiyaOmbori } from "./sessiya.ts";
import type { FonIshlar } from "../umumiy/fon.ts";
import type { Pool } from "pg";
import { OTP, telefonNormallash } from "./otp.ts";
import type { OtpMaqsadi, OtpOmbori, SmsYuboruvchi } from "./otp.ts";
import type { Oidc, TashqiKimlik } from "./oidc.ts";
import { widgetTekshir } from "./telegram.ts";
import type { MfaBogliqliklari } from "./mfa-turlar.ts";
import type { ApiKalitlar } from "./api-kalit.ts";
import type { Cheklagich } from "../umumiy/cheklov.ts";
import type { CaptchaTekshiruvchi } from "./captcha.ts";

/** So'rov konteksti — jurnal uchun (IP, brauzer) */
export type Mijoz = { ip?: string | undefined; userAgent?: string | undefined };

export type AuthBogliqliklari = {
  /** #20: auth pool (vazifalar_auth roli) — admin ro'yxati uchun to'g'ridan so'rovlar */
  pool: Pool;
  ombor: AuthOmbori;
  sessiyalar: SessiyaOmbori;
  tokenlar: BirMartalikTokenlar;
  pochtachi: Pochtachi;
  /** frontend manzili — xatdagi havolalar uchun (ILOVA_URL) */
  ilovaUrl: string;
  /** token + xat — fonda: javob vaqti email borligini oshkor qilmasin (t12 topilmasi) */
  fon: FonIshlar;
  /** #13: SMS kodlar va yuboruvchi; ruxsat etilgan mamlakat prefikslari (SMS pumping — xalqaro qimmat raqamlar) */
  otp: OtpOmbori;
  sms: SmsYuboruvchi;
  otpMamlakatlar: readonly string[];
  /** #15: tashqi OIDC provayderlar (nom → mijoz); bo'sh — tashqi kirish o'chiq */
  oidc: ReadonlyMap<string, Oidc>;
  /** #16: Telegram Login Widget (bot token — .env; berilmasa yo'llar 404) va auth_date maksimal yoshi (s) */
  telegram?: { botToken: string; maksS: number } | undefined;
  /** #19: 2FA (TOTP, zaxira kodlar) va passkeys */
  mfa: MfaBogliqliklari;
  /** #22: API kalitlari */
  apiKalitlar: ApiKalitlar;
  /** #26: tezlik cheklovi (Postgres hisoblagichlari) */
  cheklagich: Cheklagich;
  /** #30: CAPTCHA (Turnstile) — berilsa ro'yxat, parol tiklash so'rovi, SMS so'rovida "X-Captcha" sarlavhasi talab qilinadi */
  captcha?: CaptchaTekshiruvchi | undefined;
  /** #30: butun ilova bo'yicha kunlik SMS byudjeti (SMS pumping — hisob raqami qimmat xalqaro raqamlarga "nasos" qilinmasin) */
  smsKunlikMaks?: number;
};

export class TelegramXatosi extends IlovaXatosi {
  constructor(sabab: string) {
    super(401, `Telegram ma'lumoti tasdiqlanmadi (${sabab})`, { kod: "telegram-xato", sarlavha: "Telegram kirish muvaffaqiyatsiz" });
  }
}

export class OtpXatosi extends IlovaXatosi {
  constructor() {
    super(401, "Kod noto'g'ri yoki muddati o'tgan — yangisini so'rang", { kod: "otp-xato", sarlavha: "Kod noto'g'ri" });
  }
}

/** SMS so'rovi javobi — raqam ro'yxatda bor-yo'qligidan qat'iy nazar bir xil */
export const SMS_YUBORILDI = "Agar raqam hisobga ulangan bo'lsa, unga SMS kod yuborildi.";

export class KirishXatosi extends IlovaXatosi {
  constructor() {
    super(401, "Email yoki parol noto'g'ri", { kod: "kirish-xato", sarlavha: "Kirish muvaffaqiyatsiz" });
  }
}

export class TokenXatosi extends IlovaXatosi {
  constructor() {
    super(400, "Havola yaroqsiz, muddati o'tgan yoki allaqachon ishlatilgan — yangisini so'rang", { kod: "token-yaroqsiz", sarlavha: "Havola yaroqsiz" });
  }
}

/** Ro'yxat va tiklash so'rovining yagona javobi — email bor-yo'qligi oshkor bo'lmasin */
export const XAT_YUBORILDI = "Agar bu email to'g'ri bo'lsa, unga xat yuborildi. Pochtangizni tekshiring.";

export function authXizmati(d: AuthBogliqliklari) {
  const { ombor, tokenlar, pochtachi } = d;
  /** Token # dan keyin: brauzer fragmentni serverga (va Referer'ga) yubormaydi — havola server loglarida ham ko'rinmaydi */
  const havola = (yol: string, token: string) => `${d.ilovaUrl}${yol}#token=${token}`;

  async function tasdiqXati(f: Foydalanuvchi, mijoz: Mijoz): Promise<void> {
    const token = await tokenlar.yarat(f.id, "email_tasdiq", mijoz.ip);
    if (token === undefined) return; // 60 s ichida yuborilgan
    await pochtachi.yubor({
      kimga: f.email,
      mavzu: "vazifalar: emailingizni tasdiqlang",
      matn: `Assalomu alaykum, ${f.toliqIsm}!\n\nHisobni faollashtirish uchun havolani oching (24 soat amal qiladi):\n${havola("/tasdiqlash", token)}\n\nSiz ro'yxatdan o'tmagan bo'lsangiz — xatni e'tiborsiz qoldiring.`,
      shablon: { nom: "tasdiqlash", malumot: { ism: f.toliqIsm, havola: havola("/tasdiqlash", token), muddat: "24 soat" } },
    });
  }

  return {
    /** jurnalga yozish (chiqish va boshqa marshrut darajasidagi hodisalar) */
    hodisa: (h: Hodisa): Promise<void> => ombor.hodisa(h),

    /**
     * #12: javob har doim bir xil (202). Yangi email — hisob (tasdiqlanmagan) + tasdiqlash xati. Band email — egasiga ogohlantirish xati
     * (hisob o'zgarmaydi). Ikkala yo'lda ham argon2 bajariladi (hash INSERT'dan oldin), token va xat — fonda (t12).
     */
    async royxat(r: Royxat, mijoz: Mijoz): Promise<void> {
      const hash = await parolHash(r.parol);
      try {
        const f = await ombor.yarat({ email: r.email, toliqIsm: r.toliqIsm, parolHash: hash });
        await ombor.hodisa({ tur: "royxat", foydalanuvchiId: f.id, ...mijoz });
        d.fon.qosh("tasdiq-xati", () => tasdiqXati(f, mijoz));
      } catch (x) {
        if (!(x instanceof EmailBandXatosi)) throw x;
        const egasi = await ombor.emailBilan(r.email);
        await ombor.hodisa({ tur: "royxat_band", foydalanuvchiId: egasi?.id, ...mijoz });
        if (egasi !== undefined) {
          d.fon.qosh("royxat-band-xati", () => pochtachi.yubor({
            kimga: egasi.email,
            mavzu: "vazifalar: hisobingiz bilan ro'yxatdan o'tishga urinish",
            matn: `Kimdir shu email bilan yangi hisob ochmoqchi bo'ldi. Hisobingiz o'zgarmadi.\nParolni unutgan bo'lsangiz: ${d.ilovaUrl}/parol-tiklash`,
          }));
        }
      }
    },

    async kirish(k: Kirish, mijoz: Mijoz): Promise<Foydalanuvchi> {
      const hisob = await ombor.emailBilan(k.email);
      // Topilmasa yoki parolsiz hisob bo'lsa ham argon2 bajariladi — javob vaqti bir xil (t05 o'lchovi)
      const n = await parolTekshir(hisob?.parolHash ?? (await soxtaHash()), k.parol);
      if (hisob === undefined || hisob.parolHash === null || !n.togri) {
        await ombor.hodisa({ tur: "kirish_xato", foydalanuvchiId: hisob?.id, ...mijoz, tafsilot: { sabab: hisob === undefined ? "email-yoq" : hisob.parolHash === null ? "parolsiz-hisob" : "parol" } });
        throw new KirishXatosi();
      }
      // Parol to'g'ri, lekin email tasdiqlanmagan: oshkor qilish xavfsiz (parolni biladi). Tasdiqlanmagan hisob bilan kirib bo'lmaydi —
      // aks holda boshqa odamning emailiga oldindan hisob ochib qo'yish (pre-hijacking) mumkin (#15 Google bilan bog'lashda muhim)
      if (hisob.emailTasdiqlangan === null) {
        await ombor.hodisa({ tur: "kirish_xato", foydalanuvchiId: hisob.id, ...mijoz, tafsilot: { sabab: "email-tasdiqlanmagan" } });
        throw new IlovaXatosi(403, "Email tasdiqlanmagan — pochtangizdagi havolani oching yoki xatni qayta so'rang", { kod: "email-tasdiqlanmagan", sarlavha: "Email tasdiqlanmagan" });
      }
      if (n.qaytaHash) {
        await ombor.parolniYoz(hisob.id, await parolHash(k.parol));
        await ombor.hodisa({ tur: "parol_qayta_hash", foydalanuvchiId: hisob.id, ...mijoz });
      }
      await ombor.hodisa({ tur: "kirish", foydalanuvchiId: hisob.id, ...mijoz });
      return { id: hisob.id, email: hisob.email, toliqIsm: hisob.toliqIsm };
    },

    /** Tasdiqlash xatini qayta yuborish (email bo'yicha, javob bir xil) */
    async tasdiqQayta(email: string, mijoz: Mijoz): Promise<void> {
      const h = await ombor.emailBilan(email);
      if (h !== undefined && h.emailTasdiqlangan === null) d.fon.qosh("tasdiq-xati", () => tasdiqXati(h, mijoz));
    },

    /** Havoladagi token → email tasdiqlandi → foydalanuvchi (marshrut sessiya beradi) */
    async emailTasdiqla(token: string, mijoz: Mijoz): Promise<Foydalanuvchi> {
      const fid = await tokenlar.ishlat(token, "email_tasdiq");
      if (fid === undefined) throw new TokenXatosi();
      await ombor.emailTasdiqla(fid);
      await ombor.hodisa({ tur: "email_tasdiq", foydalanuvchiId: fid, ...mijoz });
      const h = await ombor.idBilan(fid);
      if (h === undefined) throw new TokenXatosi();
      return { id: h.id, email: h.email, toliqIsm: h.toliqIsm };
    },

    /** Parol tiklash so'rovi: javob bir xil. Hisob bor bo'lsa — 30 daqiqalik havola (parolsiz hisob ham parol o'rnata oladi) */
    async tiklashSorovi(email: string, mijoz: Mijoz): Promise<void> {
      const h = await ombor.emailBilan(email);
      await ombor.hodisa({ tur: "parol_tiklash_sorov", foydalanuvchiId: h?.id, ...mijoz, tafsilot: { topildi: h !== undefined } });
      if (h === undefined) return;
      // Fonda: javob vaqti ikkala yo'lda bir xil (t12: oldin mavjud email 30 ms, noma'lum 12.8 ms edi)
      d.fon.qosh("tiklash-xati", async () => {
        const token = await tokenlar.yarat(h.id, "parol_tiklash", mijoz.ip);
        if (token === undefined) return;
        await pochtachi.yubor({
          kimga: h.email,
          mavzu: "vazifalar: parolni tiklash",
          matn: `Parolni tiklash so'raldi. Yangi parol o'rnatish uchun havola (30 daqiqa, bir marta):\n${havola("/parol-tiklash", token)}\n\nSiz so'ramagan bo'lsangiz — hech narsa qilmang, parolingiz o'zgarmaydi.`,
          shablon: { nom: "tiklash", malumot: { havola: havola("/parol-tiklash", token), muddat: "30 daqiqa" } },
        });
      });
    },

    /** Yangi parol: token bir marta; parol yangilanadi, email tasdiqlanadi (xatni ochdi), BARCHA sessiyalar bekor (o'g'ri ham chiqariladi) */
    async parolTikla(token: string, yangiParol: string, mijoz: Mijoz): Promise<number> {
      // Avval (ishlatmasdan) kimniki — parol siyosati shaxsiy ma'lumot bilan tekshiriladi; yomon parolda token "yonib ketmasin"
      const egasi = await tokenlar.egasi(token, "parol_tiklash" satisfies Maqsad);
      const h = egasi === undefined ? undefined : await ombor.idBilan(egasi);
      if (h === undefined) throw new TokenXatosi();
      const sabab = taqiqlanganmi(yangiParol, [h.email, h.toliqIsm]);
      if (sabab !== undefined) throw new ValidatsiyaXatosi([{ joy: "body.parol", xabar: sabab }]);
      const fid = await tokenlar.ishlat(token, "parol_tiklash");
      if (fid === undefined) throw new TokenXatosi();
      await ombor.parolniYoz(fid, await parolHash(yangiParol));
      await ombor.emailTasdiqla(fid);
      const bekor = await d.sessiyalar.hammasiniBekorQil(fid);
      await ombor.hodisa({ tur: "parol_tiklandi", foydalanuvchiId: fid, ...mijoz, tafsilot: { bekorSessiyalar: bekor } });
      return bekor;
    },

    /**
     * #13: SMS kod so'rash (kirish yoki telefon ulash). Javob bir xil; ish fonda (vaqt ham bir xil — t12 saboqi).
     * Raqam noto'g'ri yoki ruxsat etilmagan mamlakat — 422 (bu raqam haqida hech narsa oshkor qilmaydi).
     */
    async kodSora(maqsad: OtpMaqsadi, xomTelefon: string, mijoz: Mijoz, foydalanuvchiId?: number): Promise<void> {
      const telefon = raqam(xomTelefon);
      let fid = foydalanuvchiId;
      if (maqsad === "kirish") fid = (await ombor.telefonBilan(telefon))?.id;
      else if ((await ombor.telefonBilan(telefon)) !== undefined) fid = undefined; // raqam band — SMS yubormaymiz (javob baribir bir xil)
      await ombor.hodisa({ tur: "otp_sorov", foydalanuvchiId: fid ?? foydalanuvchiId, ...mijoz, tafsilot: { maqsad, topildi: fid !== undefined } });
      if (fid === undefined) return;
      const egasi = fid;
      d.fon.qosh("sms-kod", async () => {
        // #30: kunlik global byudjet — raqam/IP cheklovlaridan tashqari (ko'p IP, ko'p hisob bilan "nasos"); oshsa — SMS yo'q, jurnalga (ogohlantirish signali)
        const b = await d.cheklagich.ol("sms-kunlik:hammasi", d.smsKunlikMaks ?? 1000, 86_400_000);
        if (!b.ruxsat) {
          await ombor.hodisa({ tur: "otp_sorov", foydalanuvchiId: egasi, ...mijoz, tafsilot: { maqsad, cheklov: "kunlik-byudjet" } });
          return;
        }
        const n = await d.otp.yarat(egasi, maqsad, telefon, mijoz.ip);
        if (n.tur === "cheklov") {
          await ombor.hodisa({ tur: "otp_sorov", foydalanuvchiId: egasi, ...mijoz, tafsilot: { maqsad, cheklov: n.sabab } });
          return;
        }
        await d.sms.yubor(telefon, `vazifalar: tasdiqlash kodi ${n.kod}. ${String(OTP.muddatMs / 60_000)} daqiqa amal qiladi. Kodni hech kimga aytmang.`);
      });
    },

    /** #13: telefon + kod bilan kirish → foydalanuvchi (marshrut sessiya beradi) */
    async kodBilanKirish(xomTelefon: string, kod: string, mijoz: Mijoz): Promise<Foydalanuvchi> {
      const telefon = raqam(xomTelefon);
      const n = await d.otp.tekshir("kirish", telefon, kod);
      const h = n.tur === "ok" ? await ombor.idBilan(n.foydalanuvchiId) : undefined;
      if (h === undefined) {
        // javob bir xil (401) — hisob chegarasi tashqariga oshkor qilinmaydi (raqam borligi ham); jurnalda ko'rinadi
        await ombor.hodisa({ tur: "kirish_xato", ...mijoz, tafsilot: { sabab: n.tur === "xato" && n.sabab !== undefined ? `otp-${n.sabab}` : "otp" } });
        throw new OtpXatosi();
      }
      await ombor.hodisa({ tur: "kirish", foydalanuvchiId: h.id, ...mijoz, tafsilot: { usul: "otp" } });
      return { id: h.id, email: h.email, toliqIsm: h.toliqIsm };
    },

    /**
     * #15: tashqi kimlik (Google OIDC) → foydalanuvchi. Tartib: (1) (provayder, sub) bog'langan bo'lsa — o'sha hisob; (2) provayder email'ni TASDIQLAGAN
     * bo'lsa va shu email bilan hisob bor — bog'lanadi (tasdiqlanmagan hisob bo'lsa — parol o'chiriladi: pre-hijacking); (3) yangi hisob (parolsiz).
     * email_verified false yoki email yo'q — rad (boshqa odamning emaili bilan "kirish" mumkin bo'lardi).
     */
    async tashqiKirish(k: TashqiKimlik, mijoz: Mijoz): Promise<Foydalanuvchi> {
      const bor = await ombor.tashqiBilan(k.provayder, k.subyekt);
      if (bor !== undefined) {
        await ombor.hodisa({ tur: "tashqi_kirish", foydalanuvchiId: bor.id, ...mijoz, tafsilot: { provayder: k.provayder } });
        return { id: bor.id, email: bor.email, toliqIsm: bor.toliqIsm };
      }
      if (k.email === undefined || !k.emailTasdiqlangan) {
        await ombor.hodisa({ tur: "tashqi_rad", ...mijoz, tafsilot: { provayder: k.provayder, sabab: "email-tasdiqlanmagan" } });
        throw new IlovaXatosi(403, "Provayder emailingizni tasdiqlamagan — boshqa usul bilan kiring", { kod: "tashqi-email-tasdiqlanmagan", sarlavha: "Email tasdiqlanmagan" });
      }
      const hisob = await ombor.emailBilan(k.email);
      let f: Foydalanuvchi;
      if (hisob === undefined) {
        try {
          f = await ombor.yaratTasdiqlangan(k.email, (k.ism ?? k.email.split("@")[0] ?? "Foydalanuvchi").slice(0, 100));
        } catch (x) {
          if (x instanceof EmailBandXatosi) throw new KonfliktXatosi("Hisob shu paytda yaratildi — qayta urining", { kod: "qayta-urining", sarlavha: "Qayta urining" });
          throw x;
        }
      } else {
        f = { id: hisob.id, email: hisob.email, toliqIsm: hisob.toliqIsm };
      }
      if (!(await ombor.tashqiBogla(f.id, k.provayder, k.subyekt, k.email, hisob?.emailTasdiqlangan === null))) {
        throw new KonfliktXatosi("Bu hisobga shu provayderning boshqa hisobi ulangan", { kod: "tashqi-band", sarlavha: "Boshqa hisob ulangan" });
      }
      await ombor.hodisa({ tur: "tashqi_boglandi", foydalanuvchiId: f.id, ...mijoz, tafsilot: { provayder: k.provayder, yangi: hisob === undefined, tozalandi: hisob?.emailTasdiqlangan === null } });
      return f;
    },

    /**
     * #16: Telegram Login Widget. Telegram email bermaydi — yangi hisob ochilmaydi: avval tizimga kirgan foydalanuvchi Telegram'ni ULAYDI
     * (telegramUlash), keyin shu Telegram bilan kira oladi. Imzo bot tokeni bilan tekshiriladi, auth_date eskirgan — rad.
     */
    async telegramKirish(maydon: Record<string, string>, mijoz: Mijoz): Promise<Foydalanuvchi> {
      const id = telegramTekshir(maydon);
      const h = await ombor.tashqiBilan("telegram", id);
      if (h === undefined) {
        await ombor.hodisa({ tur: "tashqi_rad", ...mijoz, tafsilot: { provayder: "telegram", sabab: "ulanmagan" } });
        throw new IlovaXatosi(404, "Bu Telegram hisobi hech bir hisobga ulanmagan — avval email bilan kirib, sozlamalarda ulang", { kod: "telegram-ulanmagan", sarlavha: "Telegram ulanmagan" });
      }
      await ombor.hodisa({ tur: "tashqi_kirish", foydalanuvchiId: h.id, ...mijoz, tafsilot: { provayder: "telegram" } });
      return { id: h.id, email: h.email, toliqIsm: h.toliqIsm };
    },

    async telegramUlash(foydalanuvchiId: number, maydon: Record<string, string>, mijoz: Mijoz): Promise<void> {
      const id = telegramTekshir(maydon);
      if ((await ombor.tashqiBilan("telegram", id)) !== undefined) throw new KonfliktXatosi("Bu Telegram hisobi allaqachon ulangan", { kod: "tashqi-band", sarlavha: "Boshqa hisob ulangan" });
      if (!(await ombor.tashqiBogla(foydalanuvchiId, "telegram", id, undefined, false))) {
        throw new KonfliktXatosi("Hisobingizga boshqa Telegram ulangan", { kod: "tashqi-band", sarlavha: "Boshqa hisob ulangan" });
      }
      await ombor.hodisa({ tur: "tashqi_boglandi", foydalanuvchiId, ...mijoz, tafsilot: { provayder: "telegram" } });
    },

    /** #13: tizimga kirgan foydalanuvchi o'z raqamini kod bilan tasdiqlaydi */
    async telefonTasdiqla(foydalanuvchiId: number, xomTelefon: string, kod: string, mijoz: Mijoz): Promise<string> {
      const telefon = raqam(xomTelefon);
      const n = await d.otp.tekshir("telefon_ulash", telefon, kod, foydalanuvchiId);
      if (n.tur !== "ok") throw new OtpXatosi();
      if (!(await ombor.telefonniYoz(foydalanuvchiId, telefon))) throw new KonfliktXatosi("Bu raqam boshqa hisobga ulangan", { kod: "telefon-band", sarlavha: "Raqam band" });
      await ombor.hodisa({ tur: "telefon_ulandi", foydalanuvchiId, ...mijoz });
      return telefon;
    },
  };

  /** Widget imzosi va muddati → Telegram id (satr); xato — 401 */
  function telegramTekshir(maydon: Record<string, string>): string {
    if (d.telegram === undefined) throw new IlovaXatosi(404, "Telegram kirish sozlanmagan", { kod: "provayder-yoq", sarlavha: "Provayder yo'q" });
    const n = widgetTekshir(maydon, d.telegram.botToken, d.telegram.maksS);
    if (n.tur === "xato") throw new TelegramXatosi(n.sabab);
    return String(n.foydalanuvchi.id);
  }

  /** E.164 + ruxsat etilgan mamlakat; aks holda 422 */
  function raqam(x: string): string {
    const t = telefonNormallash(x);
    if (t === undefined) throw new ValidatsiyaXatosi([{ joy: "body.telefon", xabar: "telefon raqam noto'g'ri (masalan, +998 90 000 00 00)" }]);
    if (!d.otpMamlakatlar.some((m) => t.startsWith(m))) throw new ValidatsiyaXatosi([{ joy: "body.telefon", xabar: "bu mamlakat raqamlariga SMS yuborilmaydi" }]);
    return t;
  }
}

export type AuthXizmati = ReturnType<typeof authXizmati>;
