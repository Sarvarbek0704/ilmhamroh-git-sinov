// xavfsiz-url.ts — #28 B-131 (holat 28): SSRF himoyasi — server tashqi URL'ga (webhook, keyin: foydalanuvchi bergan rasm/preview URL) so'rov yuborganda
// ichki tarmoqqa (127.0.0.1, 10.x, 169.254.169.254 bulut metadata, ::1, fc00::/7 …) "eshik" bo'lmasin.
// Qadamlar: (1) URL: faqat http(s), login:parol yo'q, port ro'yxatda; (2) DNS'ni O'ZIMIZ hal qilamiz va HAR manzilni tekshiramiz; (3) ulanish AYNAN tekshirilgan IP'ga
// (lookup ustidan) — DNS rebinding (birinchi so'rovda tashqi, ikkinchisida 127.0.0.1) ishlamaydi; (4) redirect avtomatik kuzatilmaydi — har biri qayta (1)–(3).
// node:http(s) — `lookup` opsiyasi bilan (fetch/undici'da buning uchun alohida Agent kerak — bog'liqlik qo'shilmadi).
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";

/** Ichki / maxsus manzillar (IANA special-purpose registrlari asosida). IPv4-mapped IPv6 (::ffff:a.b.c.d) — IPv4 qoidasi bilan tekshiriladi */
const TAQIQ = new BlockList();
for (const [m, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) TAQIQ.addSubnet(m, p, "ipv4");
for (const [m, p] of [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) TAQIQ.addSubnet(m, p, "ipv6");

export function ichkiManzilmi(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1] !== undefined) return TAQIQ.check(mapped[1], "ipv4");
  const tur = isIP(ip);
  if (tur === 0) return true; // IP emas — xavfsiz tomonga
  return TAQIQ.check(ip, tur === 4 ? "ipv4" : "ipv6");
}

export class SsrfXatosi extends Error {
  constructor(sabab: string) {
    super(`tashqi URL rad etildi: ${sabab}`);
    this.name = "SsrfXatosi";
  }
}

export type XavfsizSozlama = {
  /** sukut: faqat https; webhook lokal sinovida — http ham */
  httpRuxsat?: boolean;
  portlar?: readonly number[];
  kutishMs?: number;
  maksRedirect?: number;
  /** testda DNS taqlidi */
  dns?: (host: string) => Promise<{ address: string; family: number }[]>;
  /** testda: manzil taqiqlanganmi (sukut — ichkiManzilmi) */
  taqiqmi?: (ip: string) => boolean;
};

const sukutDns = (host: string) => dnsLookup(host, { all: true, verbatim: true });

/** URL va DNS tekshiruvi → ulanish uchun AYNAN shu IP (birinchi ruxsat etilgani EMAS — hammasi tekshiriladi: bittasi ichki bo'lsa ham rad) */
export async function urlTekshir(xom: string, s: XavfsizSozlama = {}): Promise<{ url: URL; ip: string; oila: number }> {
  let url: URL;
  try {
    url = new URL(xom);
  } catch {
    throw new SsrfXatosi("URL emas");
  }
  if (url.protocol !== "https:" && !(s.httpRuxsat === true && url.protocol === "http:")) throw new SsrfXatosi(`protokol ${url.protocol}`);
  if (url.username !== "" || url.password !== "") throw new SsrfXatosi("URL ichida login/parol");
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (!(s.portlar ?? [80, 443]).includes(port)) throw new SsrfXatosi(`port ${String(port)}`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const taqiqmi = s.taqiqmi ?? ichkiManzilmi;
  // URL parser "2130706433", "0x7f.1", "127.1" kabi yozuvlarni 127.0.0.1 ga keltiradi (WHATWG) — host bu yerda allaqachon kanonik
  const manzillar = isIP(host) !== 0 ? [{ address: host, family: isIP(host) }] : await (s.dns ?? sukutDns)(host).catch(() => []);
  if (manzillar.length === 0) throw new SsrfXatosi("DNS javobi yo'q");
  for (const m of manzillar) if (taqiqmi(m.address)) throw new SsrfXatosi(`ichki manzil ${m.address}`);
  const birinchi = manzillar[0];
  if (birinchi === undefined) throw new SsrfXatosi("DNS javobi yo'q");
  return { url, ip: birinchi.address, oila: birinchi.family };
}

export type XavfsizJavob = { status: number; redirectlar: number };

/** POST (webhook). Javob tanasi o'qilmaydi. Redirect: 307/308 — qayta tekshirib kuzatiladi (maks 3), boshqalari — status qaytariladi */
export async function xavfsizPost(xom: string, tana: string, s: XavfsizSozlama = {}): Promise<XavfsizJavob> {
  let manzil = xom;
  for (let r = 0; ; r++) {
    const { url, ip, oila } = await urlTekshir(manzil, s);
    // lookup — Node so'ragan hostni ham, baribir tekshirilgan IP'ga yo'naltiramiz (rebinding: ikkinchi DNS so'rovi YO'Q)
    const lookup: LookupFunction = (_h, opts, cb) => {
      if (typeof opts === "object" && opts.all === true) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: ip, family: oila }]);
      else cb(null, ip, oila);
    };
    const javob = await new Promise<{ status: number; joy?: string | undefined }>((ok, rad) => {
      const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        method: "POST", lookup, timeout: s.kutishMs ?? 2000,
        headers: { "Content-Type": "application/json", "User-Agent": "vazifalar-api/1", "Content-Length": Buffer.byteLength(tana) },
      }, (res) => {
        res.resume();
        ok({ status: res.statusCode ?? 0, joy: res.headers.location });
      });
      req.on("timeout", () => { req.destroy(new Error("vaqt tugadi")); });
      req.on("error", rad);
      req.end(tana);
    });
    if ((javob.status === 307 || javob.status === 308) && javob.joy !== undefined) {
      if (r >= (s.maksRedirect ?? 3)) throw new SsrfXatosi("redirect juda ko'p");
      manzil = new URL(javob.joy, url).href;
      continue;
    }
    return { status: javob.status, redirectlar: r };
  }
}
