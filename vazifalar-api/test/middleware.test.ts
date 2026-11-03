import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import { FRONTEND, ishgaTushir, xomSorov } from "./yordamchi.ts";

let asos = "";
let yop: () => Promise<boolean>;
beforeAll(async () => ({ asos, yop } = await ishgaTushir()));
afterAll(() => yop());

test("CORS: ruxsat etilgan origin — preflight 204 va sarlavhalar; begona origin — sarlavhasiz", async () => {
  const pre = await xomSorov(`${asos}/v1/vazifalar`, {
    metod: "OPTIONS",
    sarlavhalar: { Origin: FRONTEND, "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "content-type" },
  });
  assert.equal(pre.holat, 204);
  assert.equal(pre.sarlavhalar["access-control-allow-origin"], FRONTEND);
  assert.match(String(pre.sarlavhalar["access-control-allow-methods"]), /PATCH/);
  assert.equal(pre.sarlavhalar["access-control-max-age"], "600");
  assert.equal(pre.sarlavhalar["access-control-allow-credentials"], "true"); // 28 #25
  assert.match(String(pre.sarlavhalar["access-control-allow-headers"]), /Authorization/);
  assert.match(String(pre.sarlavhalar["vary"]), /Origin/);
  const oddiy = await xomSorov(`${asos}/v1/vazifalar`, { sarlavhalar: { Origin: FRONTEND } });
  assert.equal(oddiy.sarlavhalar["access-control-allow-origin"], FRONTEND);
  assert.equal(oddiy.sarlavhalar["access-control-expose-headers"], "Location,X-Request-Id,Idempotency-Replayed,ETag,Link,Deprecation,Sunset");
  const begona = await xomSorov(`${asos}/v1/vazifalar`, { sarlavhalar: { Origin: "https://yomon.example" } });
  assert.equal(begona.holat, 200); // server javob beradi — brauzer uni JS'ga bermaydi
  assert.equal(begona.sarlavhalar["access-control-allow-origin"], undefined);
});

test("helmet sarlavhalari (28 #24: API uchun qat'iy CSP) va x-powered-by yo'q", async () => {
  const r = await xomSorov(`${asos}/v1/vazifalar`);
  assert.equal(r.sarlavhalar["x-content-type-options"], "nosniff");
  assert.equal(r.sarlavhalar["content-security-policy"], "default-src 'none';base-uri 'none';form-action 'none';frame-ancestors 'none'");
  assert.equal(r.sarlavhalar["x-frame-options"], "DENY");
  assert.equal(r.sarlavhalar["cross-origin-resource-policy"], "same-site");
  assert.equal(r.sarlavhalar["cross-origin-opener-policy"], "same-origin");
  assert.equal(r.sarlavhalar["referrer-policy"], "no-referrer");
  assert.equal(r.sarlavhalar["permissions-policy"], "camera=(), microphone=(), geolocation=(), payment=()");
  assert.equal(r.sarlavhalar["strict-transport-security"], undefined); // HSTS faqat hsts: true (HTTPS proxy orqasida)
  assert.equal(r.sarlavhalar["x-powered-by"], undefined);
  const xato = await xomSorov(`${asos}/yoq`); // xato javobida ham
  assert.equal(xato.sarlavhalar["x-frame-options"], "DENY");
});

test("X-Request-Id: yaroqlisi qaytariladi, yo'q yoki yaroqsiz — yangi UUID", async () => {
  const bor = await xomSorov(`${asos}/v1/vazifalar`, { sarlavhalar: { "X-Request-Id": "mijoz-123456" } });
  assert.equal(bor.sarlavhalar["x-request-id"], "mijoz-123456");
  const yoq = await xomSorov(`${asos}/v1/vazifalar`);
  assert.match(String(yoq.sarlavhalar["x-request-id"]), /^[0-9a-f-]{36}$/);
  const yomon = await xomSorov(`${asos}/v1/vazifalar`, { sarlavhalar: { "X-Request-Id": "a b" } });
  assert.match(String(yomon.sarlavhalar["x-request-id"]), /^[0-9a-f-]{36}$/);
});
