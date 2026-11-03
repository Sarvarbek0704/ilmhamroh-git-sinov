// soxta/push-xizmati.ts — brauzer push xizmatining (FCM/Mozilla autopush o'rnida) lokal MOCK'i, RFC 8030/8291/8292 bo'yicha:
//   obunaYarat() — brauzer qiladigan ish: P-256 ECDH kalit juftligi + 16 bayt auth secret → PushSubscription JSON;
//   POST /push/<id> — `Authorization: vapid t=<JWT>, k=<kalit>` (ES256, aud = origin, exp ≤ 24 soat) tekshiriladi, tana aes128gcm bilan OCHILADI.
// FARQLAR: haqiqiy xizmatlar 201 qaytaradi (bu ham), lekin kvota, Topic almashtirish, TTL bo'yicha saqlash, Retry-After — taqlid qilinmaydi (faqat `holat` bilan).
import { createServer, type Server } from "node:https";
import { readFileSync } from "node:fs";
import { createECDH, createPublicKey, randomBytes, verify, type ECDH } from "node:crypto";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import type { Obuna } from "../../src/push/webpush.ts";

const require = createRequire(import.meta.url);
const ece = require("http_ece") as { decrypt: (b: Buffer, p: { version: string; privateKey: ECDH; authSecret: string }) => Buffer };

export type Qabul = { id: string; yuk: unknown; ttl: string | undefined; urgency: string | undefined; topic: string | undefined; jwt: Record<string, unknown> };
export type SoxtaPush = { url: string; obunaYarat: () => Obuna; qabul: Qabul[]; holat: Map<string, number>; rad: string[]; yop: () => Promise<void> };

const b64u = (b: Buffer) => b.toString("base64url");

/** HTTPS: web-push http:// ga yubormaydi. Sertifikat — KANON_TLS papkasidan (muhit.sh; openssl bilan yaratilgan). */
export async function soxtaPush(tlsPapka: string): Promise<SoxtaPush> {
  const kalitlar = new Map<string, { ecdh: ECDH; auth: Buffer }>();
  const qabul: Qabul[] = [];
  const rad: string[] = [];
  const holat = new Map<string, number>();
  let url = "";
  const srv: Server = createServer({ key: readFileSync(`${tlsPapka}/kalit.pem`), cert: readFileSync(`${tlsPapka}/sert.pem`) }, (req, res) => {
    const bolaklar: Buffer[] = [];
    req.on("data", (b: Buffer) => bolaklar.push(b)).on("end", () => {
      const id = /^\/push\/([\w-]+)$/.exec(req.url ?? "")?.[1] ?? "";
      const k = kalitlar.get(id);
      const majburiy = holat.get(id);
      if (!k) { res.writeHead(404).end(); return; }
      if (majburiy !== undefined) { res.writeHead(majburiy, majburiy === 429 ? { "Retry-After": "30" } : {}).end(); return; }
      const m = /^vapid t=([^,]+),\s*k=(.+)$/.exec(req.headers.authorization ?? "");
      if (!m?.[1] || !m[2]) { rad.push("vapid sarlavhasi yo'q"); res.writeHead(401).end(); return; }
      const [h, p, s] = m[1].split(".");
      const pub = Buffer.from(m[2], "base64url");
      const jwk = { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) };
      const imzoOk = h && p && s && verify("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
      const jwt = p ? (JSON.parse(Buffer.from(p, "base64url").toString()) as Record<string, unknown>) : {};
      const exp = Number(jwt["exp"]);
      if (!imzoOk || jwt["aud"] !== new URL(url).origin || !(exp > Date.now() / 1000 && exp <= Date.now() / 1000 + 24 * 3600)) {
        rad.push(`JWT: imzo ${String(imzoOk)}, aud ${String(jwt["aud"])}, exp ${String(exp)}`);
        res.writeHead(403).end();
        return;
      }
      if (req.headers["content-encoding"] !== "aes128gcm") { rad.push("content-encoding"); res.writeHead(415).end(); return; }
      const ochiq = ece.decrypt(Buffer.concat(bolaklar), { version: "aes128gcm", privateKey: k.ecdh, authSecret: b64u(k.auth) });
      qabul.push({ id, yuk: JSON.parse(ochiq.toString()) as unknown, ttl: req.headers["ttl"] as string | undefined, urgency: req.headers["urgency"] as string | undefined, topic: req.headers["topic"] as string | undefined, jwt });
      res.writeHead(201, { Location: `${url}/xabar/${String(qabul.length)}` }).end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  url = `https://127.0.0.1:${String((srv.address() as AddressInfo).port)}`;
  return {
    url,
    qabul,
    rad,
    holat,
    obunaYarat: () => {
      const ecdh = createECDH("prime256v1");
      ecdh.generateKeys();
      const auth = randomBytes(16);
      const id = b64u(randomBytes(9));
      kalitlar.set(id, { ecdh, auth });
      return { endpoint: `${url}/push/${id}`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } };
    },
    yop: () => new Promise((r) => { srv.closeAllConnections(); srv.close(() => { r(); }); }),
  };
}
