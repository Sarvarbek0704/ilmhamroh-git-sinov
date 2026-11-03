// ssrf.ts — foydalanuvchi bergan URL'ga server so'rov yuborishdan oldin: faqat ommaviy IP'lar (B-169, S: SSRF).
// Tekshiruv ULANISH paytida (undici Agent `connect.lookup`): DNS javobi tekshiriladi va AYNAN shu IP'ga ulaniladi — DNS rebinding (avval ommaviy, keyin 127.0.0.1)
// oynasi yopiladi. URL'ni oldindan `dns.lookup` qilib, keyin fetch qilish — rebinding'ga ochiq (ikki marta so'raladi).
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent } from "undici";

const taqiq = new BlockList();
for (const [tarmoq, prefiks] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) taqiq.addSubnet(tarmoq, prefiks, "ipv4");
for (const [tarmoq, prefiks] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96]] as const) taqiq.addSubnet(tarmoq, prefiks, "ipv6");

/** IPv4-mapped IPv6 (::ffff:127.0.0.1) ham tekshiriladi. */
export function ommaviyIpmi(ip: string): boolean {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const v4 = m?.[1];
  if (v4) return !taqiq.check(v4, "ipv4");
  const tur = isIP(ip);
  if (tur === 0) return false;
  return !taqiq.check(ip, tur === 4 ? "ipv4" : "ipv6");
}

export class SsrfXato extends Error {
  readonly code = "SSRF_TAQIQ";
  constructor(xabar: string) {
    super(xabar);
    this.name = "SsrfXato";
  }
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** undici Agent: har ulanishda DNS javobidagi barcha manzillar ommaviy bo'lishi shart. `ruxsat` — test/lokal uchun istisno (masalan 127.0.0.1 mock). */
export function xavfsizAgent(o: { ruxsat?: (ip: string) => boolean; ulanishMs?: number } = {}): Agent {
  return new Agent({
    connect: {
      timeout: o.ulanishMs ?? 5000,
      lookup: (host: string, opts: LookupOptions, cb: LookupCb) => {
        dnsLookup(host, { ...opts, all: true }, (err, manzillar) => {
          if (err) { cb(err, []); return; }
          const yomon = manzillar.find((a) => !ommaviyIpmi(a.address) && !(o.ruxsat?.(a.address) ?? false));
          if (yomon) { cb(new SsrfXato(`taqiqlangan manzil: ${host} → ${yomon.address}`), []); return; }
          if (opts.all) cb(null, manzillar);
          else { const b = manzillar[0]; if (!b) { cb(new SsrfXato(`manzil yo'q: ${host}`), []); return; } cb(null, b.address, b.family); }
        });
      },
    },
  });
}

/** URL shakli: faqat http(s), foydalanuvchi:parol yo'q, port — 80/443 yoki ruxsat etilgan. IP literal bo'lsa — darhol tekshiriladi. */
export function urlTekshir(url: string, o: { httpRuxsat?: boolean; portlar?: number[] | "hammasi" } = {}): URL {
  let u: URL;
  try { u = new URL(url); } catch { throw new SsrfXato("URL noto'g'ri"); }
  if (u.protocol !== "https:" && !(o.httpRuxsat && u.protocol === "http:")) throw new SsrfXato("faqat https");
  if (u.username || u.password) throw new SsrfXato("URL ichida login/parol");
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (o.portlar !== "hammasi" && !(o.portlar ?? [80, 443]).includes(port)) throw new SsrfXato(`port ${String(port)} taqiqlangan`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !ommaviyIpmi(host)) throw new SsrfXato(`taqiqlangan IP: ${host}`);
  return u;
}
