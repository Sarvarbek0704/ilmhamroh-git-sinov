// totp.test.ts — #19: o'zimiz yozgan TOTP — RFC 6238 Appendix B va RFC 4648 base32 test vektorlari, oyna, qayta ishlatish, AES-GCM
import { test } from "vitest";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { base32, deshifrla, hotp, otpauthUri, qadam, shifrla, totpTekshir } from "../src/auth/totp.ts";

test("RFC 6238 Appendix B (SHA-1, 8 raqam, seed '12345678901234567890')", () => {
  const siri = Buffer.from("12345678901234567890");
  for (const [t, kod] of [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]] as const) {
    assert.equal(hotp(siri, qadam(t * 1000), 8), kod, String(t));
  }
});

test("RFC 4648 base32 vektorlari", () => {
  for (const [x, k] of [["", ""], ["f", "MY"], ["fo", "MZXQ"], ["foo", "MZXW6"], ["foob", "MZXW6YQ"], ["fooba", "MZXW6YTB"], ["foobar", "MZXW6YTBOI"]] as const) {
    assert.equal(base32(Buffer.from(x)), k, x);
  }
  assert.equal(base32(Buffer.from("12345678901234567890")), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
});

test("totpTekshir: ±1 qadam oyna; 2 qadam — rad; oxirgi qadamdan eski/teng — rad (qayta ishlatish); format", () => {
  const siri = randomBytes(20);
  const t = 1_800_000_000_000;
  const q = qadam(t);
  const kod = hotp(siri, q);
  assert.equal(totpTekshir(siri, kod, 0n, t), q);
  assert.equal(totpTekshir(siri, hotp(siri, q - 1n), 0n, t), q - 1n);
  assert.equal(totpTekshir(siri, hotp(siri, q + 1n), 0n, t), q + 1n);
  assert.equal(totpTekshir(siri, hotp(siri, q - 2n), 0n, t), undefined);
  assert.equal(totpTekshir(siri, kod, q, t), undefined); // xuddi shu kod ikkinchi marta
  for (const x of ["", "12345", "1234567", "abcdef"]) assert.equal(totpTekshir(siri, x, 0n, t), undefined);
});

test("otpauth URI va AES-GCM: boshqa foydalanuvchi (aad) yoki buzilgan shifr — xato", () => {
  assert.match(otpauthUri(Buffer.from("12345678901234567890"), "aziz@example.com"), /^otpauth:\/\/totp\/vazifalar%3Aaziz%40example\.com\?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=vazifalar&algorithm=SHA1&digits=6&period=30$/);
  const k = randomBytes(32);
  const s = shifrla(k, Buffer.from("siri"), "1");
  assert.equal(deshifrla(k, s, "1").toString(), "siri");
  assert.throws(() => deshifrla(k, s, "2"));
  const buzuq = Buffer.from(s);
  buzuq[buzuq.length - 1] = (buzuq[buzuq.length - 1] ?? 0) ^ 1;
  assert.throws(() => deshifrla(k, buzuq, "1"));
});
