// parol.ts — #04 B-108 (holat 04): parolni xavfsiz saqlash. argon2id, Node 24 ning o'z crypto.argon2 (v24.7.0+, OpenSSL 3.2+) — bog'liqliksiz.
// O'lchov (natijalar/tajriba/t04-parol.txt): OWASP parametrlari m=19456 KiB, t=2, p=1 — ~30 ms; argon2 paketi ~15 % tezroq, lekin native binar;
// bcrypt cost 10 ~70 ms va 72 bayt chegarasi (73-baytdan keyingisi e'tiborga olinmaydi); sha256 — 1 soniyada 130 ming (hujumchi uchun qulay).
// Saqlash formati — PHC satri: $argon2id$v=19$m=19456,t=2,p=1$<tuz>$<hash> — parametrlar hash bilan birga (keyin oshirsak, eskilari ham tekshiriladi).
import { argon2 as argon2Cb, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Semafor } from "../umumiy/semafor.ts";

const argon2 = promisify(argon2Cb);

export type Argon2Parametrlari = { m: number; t: number; p: number };

/** OWASP Password Storage Cheat Sheet (argon2id, minimal tavsiya). Oshirilsa — eski hash'lar login paytida qayta hash'lanadi */
export const JORIY: Argon2Parametrlari = Object.freeze({ m: 19_456, t: 2, p: 1 });

const TUZ_BAYT = 16;
const HASH_BAYT = 32;
// PHC: base64 "=" siz. Parametrlar oralig'i — DoS himoyasi: bazadagi buzilgan satr serverni 4 GiB xotira ajratishga majburlamasin
const PHC = /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]{16,64})\$([A-Za-z0-9+/]{32,128})$/;
const CHEGARA = { mMaks: 262_144, tMaks: 10, pMaks: 8 };

const b64 = (b: Buffer): string => b.toString("base64").replace(/=+$/, "");

/**
 * #29: bir vaqtda 4 ta hash (libuv threadpool sukut 4 — ko'pi baribir navbatda turadi), navbatda 64 tagacha; ortig'i — 503 server-band.
 * t29: cheklovsiz 200 parallel login paytida oddiy GET p99 42 ms → 3.3 s (pool va threadpool navbati), RSS +94 MiB.
 */
export const HASH_SEMAFORI = new Semafor(4, 64);

async function hisobla(parol: string, tuz: Buffer, prm: Argon2Parametrlari, uzunlik = HASH_BAYT): Promise<Buffer> {
  return HASH_SEMAFORI.bajar(() => argon2("argon2id", { message: parol, nonce: tuz, memory: prm.m, passes: prm.t, parallelism: prm.p, tagLength: uzunlik }));
}

export async function parolHash(parol: string, prm: Argon2Parametrlari = JORIY): Promise<string> {
  const tuz = randomBytes(TUZ_BAYT);
  const h = await hisobla(parol, tuz, prm);
  return `$argon2id$v=19$m=${String(prm.m)},t=${String(prm.t)},p=${String(prm.p)}$${b64(tuz)}$${b64(h)}`;
}

export type TekshiruvNatijasi = { togri: boolean; qaytaHash: boolean };

/**
 * Parolni saqlangan PHC satri bilan solishtiradi. `qaytaHash` — parol to'g'ri, lekin hash eski parametrlar bilan: login paytida yangisini
 * yozish kerak (rehash on login). Formati tanilmagan satr — `togri: false` (xato tashlamaydi: bazadagi buzuq qator login'ni 500 qilmasin).
 */
export async function parolTekshir(saqlangan: string, parol: string, joriy: Argon2Parametrlari = JORIY): Promise<TekshiruvNatijasi> {
  const t = PHC.exec(saqlangan);
  if (t === null) return { togri: false, qaytaHash: false };
  const [, m, tt, p, tuz, hash] = t;
  const prm = { m: Number(m), t: Number(tt), p: Number(p) };
  if (prm.m > CHEGARA.mMaks || prm.t > CHEGARA.tMaks || prm.p > CHEGARA.pMaks || prm.m < 8 * prm.p) return { togri: false, qaytaHash: false };
  const kutilgan = Buffer.from(hash ?? "", "base64");
  const h = await hisobla(parol, Buffer.from(tuz ?? "", "base64"), prm, kutilgan.length);
  // timingSafeEqual — solishtirish vaqti mos kelgan baytlar soniga bog'liq emas
  const togri = h.length === kutilgan.length && timingSafeEqual(h, kutilgan);
  return { togri, qaytaHash: togri && (prm.m !== joriy.m || prm.t !== joriy.t || prm.p !== joriy.p) };
}

/**
 * Foydalanuvchi topilmaganda ham BIR XIL ish (argon2) bajariladi — javob vaqti "bunday email yo'q" ni oshkor qilmasin (timing, #05).
 * Ishga tushishda bir marta hisoblanadi.
 */
let soxta: Promise<string> | undefined;
export function soxtaHash(): Promise<string> {
  soxta ??= parolHash(randomBytes(32).toString("base64"));
  return soxta;
}
