// nest-auth.test.ts — 30 B: 28-qism auth'ining Nest'ga ko'chishida YANGI paydo bo'lgan xavflar regressiyasi (28 testlari ularni ko'rmaydi):
//   - "yopiq sukut": global KirishGuard — har marshrut anonim so'rovga 401, ochiqlari aniq ro'yxat (inventar, API9);
//   - guard tartibi: anonim + noto'g'ri Content-Type → 401 (415 emas — kim ekanini oshkor qilmasdan avval kirish);
//   - Idempotency-Key: middleware guard'dan OLDIN ishlaydi — 401 javobi kalitga saqlanmaydi;
//   - SSE (/vazifalar/oqim) va eksport ishlari — faqat o'z egasiniki (28 da SSE yo'q edi; eksport — xotirada, RLS himoya qilmaydi);
//   - /docs — Swagger UI uchun yumshoq CSP, API — qat'iy; servislararo HMAC yo'li (Nest guard'i).
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { ilovaYarat } from "../src/ilova.ts";
import { PgOmbori } from "../src/vazifalar/pg-ombor.ts";
import { hmacImzo, imzoSatri } from "../src/auth/api-kalit.ts";
import { authBaza, authBogliqliklari, hisobOch, tozala } from "./auth-yordam.ts";

const baza = await authBaza("nest");
if (typeof baza === "string") {
  test.skip(`Nest auth (Postgres) — ${baza}`, () => {});
} else {
  const pool = baza;
  const d = authBogliqliklari(pool);
  const ICHKI = randomBytes(32);
  const app = await ilovaYarat({ ombor: (e) => new PgOmbori(pool, e), auth: d, ichkiSir: ICHKI });
  const http = app.getHttpAdapter().getInstance() as Parameters<typeof request>[0];
  afterAll(async () => {
    await app.close();
    await pool.end();
  });
  beforeEach(() => tozala(pool));

  /** Kirishsiz ochiq marshrutlar — ATAYLAB ro'yxat: yangi @Ochiq() qo'shilsa, shu test yiqiladi (ko'rib chiqib qo'shiladi) */
  const OCHIQ = [
    "GET /health/live", "GET /health/ready", "GET /health/startup",
    "POST /v1/auth/royxat", "POST /v1/auth/email-tasdiq", "POST /v1/auth/email-tasdiq/qayta", "POST /v1/auth/parol-tiklash/sorov", "POST /v1/auth/parol-tiklash",
    "POST /v1/auth/kirish", "POST /v1/auth/chiqish", "POST /v1/auth/otp/yubor", "POST /v1/auth/otp/kirish",
    "GET /v1/auth/oidc/:provayder", "GET /v1/auth/oidc/:provayder/qaytish", "POST /v1/auth/telegram",
    "POST /v1/auth/2fa/tekshir", "POST /v1/auth/passkey/kirish/boshla", "POST /v1/auth/passkey/kirish/yakun",
    // POST /v1/ichki/tekshiruv — @Ochiq (foydalanuvchi emas), lekin HMAC imzosiz 401 (ServisImzoGuard) — shuning uchun bu ro'yxatda yo'q
  ];

  test("yopiq sukut: har marshrut (ALL'dan tashqari) anonim so'rovga 401; 401 bermaganlari — aynan OCHIQ ro'yxati", async () => {
    const discovery = app.get(DiscoveryService);
    const scanner = app.get(MetadataScanner);
    const reflector = app.get(Reflector);
    const ochiqlar: string[] = [];
    let jami = 0;
    for (const w of discovery.getControllers()) {
      if (w.metatype === null || w.instance === undefined) continue;
      const asos = reflector.get<string>(PATH_METADATA, w.metatype);
      const versiyasiz = asos === "health";
      const proto = Object.getPrototypeOf(w.instance) as Record<string, () => unknown>;
      for (const nom of scanner.getAllMethodNames(proto)) {
        const h = proto[nom];
        const yol = h === undefined ? undefined : reflector.get<string | undefined>(PATH_METADATA, h);
        const metod = h === undefined ? undefined : reflector.get<RequestMethod | undefined>(METHOD_METADATA, h);
        if (yol === undefined || metod === undefined || metod === RequestMethod.ALL) continue;
        const nusxa = `${versiyasiz ? "" : "/v1"}/${asos}${yol === "/" ? "" : `/${yol}`}`;
        const m = RequestMethod[metod];
        const url = nusxa.replace(/:[a-z]+/g, (p) => (p === ":provayder" ? "google" : "1"));
        const r = await request(http)[m.toLowerCase() as "get"](url).set("Origin", "http://localhost:5173");
        jami++;
        if (r.status !== 401) ochiqlar.push(`${m} ${nusxa}`);
      }
    }
    expect(jami).toBeGreaterThan(40);
    expect(ochiqlar.sort()).toEqual([...OCHIQ].sort());
  });

  test("guard tartibi: anonim + text/plain → 401 (415 emas); kirgan — 415", async () => {
    await request(http).post("/v1/vazifalar").set("Content-Type", "text/plain").send("x").expect(401);
    const c = await hisobOch(http, d, "aziz@example.com");
    await request(http).post("/v1/vazifalar").set("Cookie", c).set("Content-Type", "text/plain").send("x").expect(415);
  });

  test("Idempotency-Key: anonim so'rov (401) kalitni egallamaydi — kirgandan keyin shu kalit bilan 201, takror — saqlangan javob", async () => {
    await request(http).post("/v1/vazifalar").set("Idempotency-Key", "kalit-anonim-1").send({ matn: "Non" }).expect(401);
    const c = await hisobOch(http, d, "aziz@example.com");
    const a = await request(http).post("/v1/vazifalar").set("Cookie", c).set("Idempotency-Key", "kalit-anonim-1").send({ matn: "Non" }).expect(201);
    const b = await request(http).post("/v1/vazifalar").set("Cookie", c).set("Idempotency-Key", "kalit-anonim-1").send({ matn: "Non" }).expect(201);
    expect(b.headers["idempotency-replayed"]).toBe("true");
    expect(b.body).toEqual(a.body);
  });

  test("eksport: begona ish id'si — 404 (holat ham, fayl ham); egasiniki — 200", async () => {
    const aziz = await hisobOch(http, d, "aziz@example.com");
    const dilnoza = await hisobOch(http, d, "dilnoza@example.com");
    await request(http).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Azizning siri" }).expect(201);
    const r = await request(http).post("/v1/eksportlar").set("Cookie", aziz).send({ format: "json" }).expect(202);
    const yol = String(r.headers["location"]);
    await request(http).get(yol).set("Cookie", dilnoza).expect(404);
    await request(http).get(`${yol}/fayl`).set("Cookie", dilnoza).expect(404);
    for (let i = 0; i < 50; i++) {
      const h = await request(http).get(yol).set("Cookie", aziz).expect(200);
      if ((h.body as { holat: string }).holat === "tayyor") break;
      await new Promise((t) => setTimeout(t, 20));
    }
    const f = await request(http).get(`${yol}/fayl`).set("Cookie", aziz).expect(200);
    expect(f.text).toContain("Azizning siri");
  });

  test("SSE /v1/vazifalar/oqim: faqat o'z hodisalari — Dilnozaning vazifasi Azizning oqimiga tushmaydi", async () => {
    const aziz = await hisobOch(http, d, "aziz@example.com");
    const dilnoza = await hisobOch(http, d, "dilnoza@example.com");
    const server = app.getHttpServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address() as AddressInfo;
      const boshqaruv = new AbortController();
      const javob = await fetch(`http://127.0.0.1:${String(port)}/v1/vazifalar/oqim`, { headers: { Cookie: aziz }, signal: boshqaruv.signal });
      expect(javob.status).toBe(200);
      const oquvchi = (javob.body as ReadableStream<Uint8Array>).getReader();
      await request(http).post("/v1/vazifalar").set("Cookie", dilnoza).send({ matn: "Dilnozaniki" }).expect(201);
      await request(http).post("/v1/vazifalar").set("Cookie", aziz).send({ matn: "Azizniki" }).expect(201);
      let matn = "";
      while (!matn.includes("Azizniki")) {
        const { value, done } = await oquvchi.read();
        if (done) break;
        matn += new TextDecoder().decode(value);
      }
      boshqaruv.abort();
      expect(matn).toContain("event: vazifa.yaratildi");
      expect(matn).toContain("Azizniki");
      expect(matn).not.toContain("Dilnozaniki");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test("anonim SSE — 401 (oqim ochilmaydi)", async () => {
    await request(http).get("/v1/vazifalar/oqim").expect(401);
  });

  describe("sarlavhalar", () => {
    test("API — qat'iy CSP (default-src 'none'), DENY, Permissions-Policy; /docs — Swagger UI ishlashi uchun 'self' CSP", async () => {
      const a = await request(http).get("/health/live").expect(200);
      expect(a.headers["content-security-policy"]).toMatch(/^default-src 'none'/);
      expect(a.headers["x-frame-options"]).toBe("DENY");
      expect(a.headers["permissions-policy"]).toContain("camera=()");
      const h = await request(http).get("/docs/").expect(200);
      expect(h.headers["content-security-policy"]).toContain("default-src 'self'");
      expect(h.headers["content-security-policy"]).toContain("script-src 'self'");
    });

    test("auth javoblari — Cache-Control: no-store (xato javobi ham)", async () => {
      const r = await request(http).post("/v1/auth/kirish").send({ email: "yoq@example.com", parol: "notogri-parol-12345" }).expect(401);
      expect(r.headers["cache-control"]).toBe("no-store");
    });
  });

  test("servislararo HMAC (ichki): imzosiz 401, to'g'ri imzo 200, takror nonce 401", async () => {
    await request(http).post("/v1/ichki/tekshiruv").send({ a: 1 }).expect(401);
    const tana = JSON.stringify({ a: 1 });
    const vaqt = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString("base64url");
    const imzo = hmacImzo(ICHKI, imzoSatri("POST", "/v1/ichki/tekshiruv", vaqt, nonce, tana));
    const yubor = () => request(http).post("/v1/ichki/tekshiruv").set("Content-Type", "application/json").set("X-Vaqt", vaqt).set("X-Nonce", nonce).set("X-Imzo", imzo).send(tana);
    expect((await yubor().expect(200)).body).toEqual({ qabul: true, tana: { a: 1 } });
    await yubor().expect(401);
  });
}
