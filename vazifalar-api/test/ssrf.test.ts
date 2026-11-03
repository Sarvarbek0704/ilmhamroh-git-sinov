// ssrf.test.ts — #28 (holat 28): ichki manzillar jadvali, URL hiylalari (o'nlik/hex IP, IPv6, mapped, login:parol, port), DNS (bitta ichki manzil ham — rad),
// DNS rebinding (ulanish tekshirilgan IP'ga), redirect ichkariga — rad. Tashqi internetga so'rov YO'Q: "tashqi" sayt — lokal server, DNS — taqlid.
import { afterAll, test } from "vitest";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ichkiManzilmi, SsrfXatosi, urlTekshir, xavfsizPost } from "../src/umumiy/xavfsiz-url.ts";

test("ichkiManzilmi: loopback, xususiy, link-local (bulut metadata), CGNAT, IPv6 ULA/link-local, mapped; ommaviy — ruxsat", () => {
  for (const ip of ["127.0.0.1", "127.255.0.9", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "224.0.0.1", "nomi"]) {
    assert.equal(ichkiManzilmi(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "195.158.1.1", "2a00:1450:4001::200e", "::ffff:8.8.8.8"]) assert.equal(ichkiManzilmi(ip), false, ip);
});

test("URL hiylalari — hammasi rad (WHATWG URL parser IPv4 yozuvlarini kanonik qiladi)", async () => {
  const dns = () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
  for (const u of ["http://127.0.0.1/", "https://2130706433/", "https://0x7f.1/", "https://127.1/", "https://[::1]/", "https://[::ffff:127.0.0.1]/", "https://169.254.169.254/latest/meta-data/",
    "https://0/", "ftp://example.com/", "file:///etc/passwd", "https://user:pass@example.com/", "https://example.com:22/", "javascript:alert(1)"]) {
    await assert.rejects(urlTekshir(u, { dns }), SsrfXatosi, u);
  }
  assert.equal((await urlTekshir("https://hook.example.uz/v", { dns })).ip, "93.184.216.34");
  await assert.rejects(urlTekshir("http://hook.example.uz/v", { dns }), /protokol/); // sukut — faqat https
});

test("DNS: birorta javob ichki bo'lsa — rad (A-yozuvlardan biri 10.0.0.5); javob yo'q — rad", async () => {
  const dns = () => Promise.resolve([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }]);
  await assert.rejects(urlTekshir("https://aralash.example/", { dns }), /ichki manzil 10\.0\.0\.5/);
  await assert.rejects(urlTekshir("https://yoq.example/", { dns: () => Promise.reject(new Error("ENOTFOUND")) }), /DNS/);
});

// Lokal "tashqi" server: testda 127.0.0.1 ruxsat etiladi FAQAT shu port uchun (taqiqmi taqlidi), qolgan ichki manzillar — haqiqiy qoida
const qabul: string[] = [];
const tashqi = createServer((req, res) => {
  qabul.push(`${String(req.method)} ${String(req.url)}`);
  if (req.url === "/ichkariga") { res.writeHead(307, { Location: "http://169.254.169.254/latest/meta-data/" }); res.end(); return; }
  if (req.url === "/boshqa-yolga") { res.writeHead(308, { Location: "/oxirgi" }); res.end(); return; }
  res.writeHead(204); res.end();
});
await new Promise<void>((r) => tashqi.listen(0, "127.0.0.1", r));
const PORT = (tashqi.address() as AddressInfo).port;
afterAll(() => { tashqi.close(); });

test("DNS rebinding: DNS ikkinchi marta 169.254.169.254 qaytarsa ham — ulanish birinchi TEKSHIRILGAN IP'ga; redirect ichkariga — rad; tashqi redirect — kuzatiladi", async () => {
  let n = 0;
  const dns = () => Promise.resolve([{ address: n++ === 0 ? "127.0.0.1" : "169.254.169.254", family: 4 }]);
  const s = { httpRuxsat: true, portlar: [PORT], dns, taqiqmi: (ip: string) => ip !== "127.0.0.1" && ichkiManzilmi(ip) };
  const j = await xavfsizPost(`http://hook.test:${String(PORT)}/v`, "{}", s);
  assert.deepEqual(j, { status: 204, redirectlar: 0 });
  assert.equal(n, 1, "ikkinchi DNS so'rovi bo'lmadi (Node lookup'i tekshirilgan IP'ni oldi)");
  await assert.rejects(xavfsizPost(`http://hook.test:${String(PORT)}/ichkariga`, "{}", { ...s, dns: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]) }), /ichki manzil 169\.254\.169\.254|port/);
  const r = await xavfsizPost(`http://hook.test:${String(PORT)}/boshqa-yolga`, "{}", { ...s, dns: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]) });
  assert.deepEqual(r, { status: 204, redirectlar: 1 });
  assert.ok(qabul.includes("POST /oxirgi"));
});
