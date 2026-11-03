// parol.test.ts — #04 (holat 04): argon2id hash (PHC), tekshirish, rehash bayrog'i, buzuq/xavfli satrlar
import { test } from "vitest";
import assert from "node:assert/strict";
import { JORIY, parolHash, parolTekshir, soxtaHash } from "../src/auth/parol.ts";

const PAROL = "Bahor-choyxona-2026";

test("parolHash — PHC satri, joriy parametrlar, har safar boshqa tuz", async () => {
  const a = await parolHash(PAROL);
  const b = await parolHash(PAROL);
  assert.match(a, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
  assert.notEqual(a, b);
  assert.ok(!a.includes(PAROL));
});

test("parolTekshir — to'g'ri / noto'g'ri / registr va bo'shliq farq qiladi", async () => {
  const h = await parolHash(PAROL);
  assert.deepEqual(await parolTekshir(h, PAROL), { togri: true, qaytaHash: false });
  for (const x of ["bahor-choyxona-2026", `${PAROL} `, "", "Bahor-choyxona-2027"]) assert.equal((await parolTekshir(h, x)).togri, false, x);
});

test("Unicode: o'zbekcha va kirill parol (NFC/NFD farqi — normallashtirish chaqiruvchida)", async () => {
  const h = await parolHash("Gʻalaba-Ўзбекистон-2026");
  assert.equal((await parolTekshir(h, "Gʻalaba-Ўзбекистон-2026")).togri, true);
  // "Ў" = U+040E; NFD da U+0423 + U+0306 — baytlari boshqa, hash ham boshqa (shuning uchun sxema NFC ga keltiradi, #05)
  assert.equal((await parolTekshir(h, "Gʻalaba-Ўзбекистон-2026".normalize("NFD"))).togri, false);
});

test("eski parametrlar bilan hash — to'g'ri, lekin qaytaHash: true (rehash on login)", async () => {
  const eski = await parolHash(PAROL, { m: 4096, t: 1, p: 1 });
  assert.deepEqual(await parolTekshir(eski, PAROL), { togri: true, qaytaHash: true });
  assert.deepEqual(await parolTekshir(eski, "x"), { togri: false, qaytaHash: false });
  assert.deepEqual(JORIY, { m: 19_456, t: 2, p: 1 });
});

test("buzuq yoki xavfli satr — xato emas, togri: false (bcrypt, ochiq parol, juda katta m — DoS)", async () => {
  const yaxshi = await parolHash(PAROL);
  const katta = yaxshi.replace("m=19456", "m=4194304"); // 4 GiB so'rasa — hisoblamaymiz
  for (const s of ["", PAROL, "$2b$10$abcdefghijklmnopqrstuuJ1Yyq0zqP2yXv8xQ3lQx4n1yQy9n6qG", katta, yaxshi.replace("argon2id", "argon2i"), `${yaxshi}x!`]) {
    const b = performance.now();
    assert.deepEqual(await parolTekshir(s, PAROL), { togri: false, qaytaHash: false }, s);
    assert.ok(performance.now() - b < 200);
  }
});

test("soxtaHash — bir marta hisoblanadi, hech qaysi parolga mos kelmaydi", async () => {
  const h = await soxtaHash();
  assert.equal(h, await soxtaHash());
  assert.equal((await parolTekshir(h, PAROL)).togri, false);
});
