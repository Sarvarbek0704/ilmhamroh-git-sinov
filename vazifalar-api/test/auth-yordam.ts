// auth-yordam.ts — auth testlari uchun: alohida baza (TEST_AUTH_DATABASE_URL — node --test fayllarni parallel jarayonlarda ishga tushiradi, 27 holat 20
// topilmasi: bitta bazada TRUNCATE bir-birini buzadi), har test oldidan tozalash, supertest uchun ilova.
import type { Pool } from "pg";
import request from "supertest";

import { pgPool } from "../src/vazifalar/pg-ombor.ts";
import { AuthOmbori } from "../src/auth/ombor.ts";
import { SessiyaOmbori } from "../src/auth/sessiya.ts";
import type { SessiyaSozlamasi } from "../src/auth/sessiya.ts";
import { BirMartalikTokenlar } from "../src/auth/token.ts";
import { XotiraPochtachi } from "../src/auth/pochta.ts";
import type { AuthBogliqliklari } from "../src/auth/xizmat.ts";
import { FonIshlar } from "../src/umumiy/fon.ts";
import { OtpOmbori, XotiraSms } from "../src/auth/otp.ts";
import { MfaOmbori } from "../src/auth/mfa.ts";
import { ImzoliCookie } from "../src/auth/imzo-cookie.ts";
import { ApiKalitlar } from "../src/auth/api-kalit.ts";
import { Cheklovsiz } from "../src/umumiy/cheklov.ts";
import { randomBytes } from "node:crypto";

export const AUTH_URL = process.env["TEST_AUTH_DATABASE_URL"] ?? "postgres://postgres@127.0.0.1:5496/vazifalar_test_auth";

/**
 * Har test FAYLI o'z bazasida: TEST_AUTH_DATABASE_URL (sxema qurilgan, namunasiz) — SHABLON, undan `<shablon>_<fayl>` nusxa (CREATE DATABASE … TEMPLATE,
 * ~0.3 s, 27 #62 o'lchovi). Sabab: node --test fayllarni parallel jarayonlarda ishga tushiradi — bitta bazada bir fayl TRUNCATE qilsa,
 * boshqasining ma'lumoti yo'qoladi (28 #07 da auth.test va sessiya.test bir-birini yiqitdi; 27 holat 20 topilmasi takrorlandi).
 * Baza bo'lmasa — SKIP sababi (satr).
 */
export async function authBaza(fayl = "asosiy"): Promise<Pool | string> {
  const shablon = new URL(AUTH_URL);
  const nusxa = `${shablon.pathname.slice(1)}_${fayl}`;
  const admin = pgPool(Object.assign(new URL(AUTH_URL), { pathname: "/postgres" }).toString(), { max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${nusxa}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${nusxa}" TEMPLATE "${shablon.pathname.slice(1)}"`);
  } catch (x) {
    return `auth test bazasi yo'q (${AUTH_URL}): ${x instanceof Error ? x.message : String(x)}`;
  } finally {
    await admin.end();
  }
  const pool = pgPool(Object.assign(new URL(AUTH_URL), { pathname: `/${nusxa}` }).toString(), { max: 5, connectionTimeoutMillis: 10_000 });
  try {
    await pool.query("SELECT 1 FROM auth_hodisalar LIMIT 0");
    return pool;
  } catch (x) {
    await pool.end();
    return `auth test bazasi sxemasi eski (${AUTH_URL}): ${x instanceof Error ? x.message : String(x)}`;
  }
}

/** Hamma foydalanuvchi ma'lumoti o'chadi (CASCADE — vazifalar, auth jadvallari), id hisoblagichlari 1 dan */
export async function tozala(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ t: string }>(
    "SELECT string_agg(format('%I', tablename), ', ') AS t FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
  await pool.query(`TRUNCATE ${rows[0]?.t ?? "foydalanuvchilar"} RESTART IDENTITY CASCADE`);
}

export const PAROL = "Bahor-choyxona-2026";

/** Set-Cookie dan sessiya cookie'si → keyingi so'rovlar uchun "Cookie" sarlavhasi qiymati */
export function cookieniOl(setCookie: string[] | string | undefined, nom = "__Host-sessiya"): string {
  const c = (Array.isArray(setCookie) ? setCookie : [setCookie ?? ""]).find((x) => x.startsWith(`${nom}=`));
  if (c === undefined) throw new Error(`Set-Cookie da ${nom} yo'q`);
  return c.split(";")[0] ?? "";
}

/** Auth bog'liqliklari (xatlar xotirada — test ichidan havolani olish uchun) */
export type TestAuth = AuthBogliqliklari & { pochtachi: XotiraPochtachi; sms: XotiraSms };

export function authBogliqliklari(pool: Pool, s?: SessiyaSozlamasi): TestAuth {
  // Fon ishidagi xato testni yiqitsin (jim yutilmasin): xato tugashi() orqali qaytadi
  const fon = new FonIshlar(() => ({ error: (o) => { throw o.err; } }));
  return { pool, ombor: new AuthOmbori(pool), sessiyalar: new SessiyaOmbori(pool, s), tokenlar: new BirMartalikTokenlar(pool), pochtachi: new XotiraPochtachi(), ilovaUrl: "http://localhost:5173", fon,
    otp: new OtpOmbori(pool, randomBytes(32)), sms: new XotiraSms(), otpMamlakatlar: ["+998"], oidc: new Map(),
    mfa: {
      ombor: new MfaOmbori(pool, randomBytes(32), randomBytes(32)),
      kutish: new ImzoliCookie("mfa", randomBytes(32), 5 * 60_000, true),
      chaqiriq: new ImzoliCookie("webauthn", randomBytes(32), 5 * 60_000, true),
      rpId: "localhost",
      originlar: ["http://localhost:5173"],
    },
    apiKalitlar: new ApiKalitlar(pool, randomBytes(32)),
    cheklagich: new Cheklovsiz() };
}

/** Fondagi xatlar yuborilib bo'lgach — oxirgi xat tokeni */
export async function xatToken(d: TestAuth, kimga?: string): Promise<string> {
  await d.fon.tugashi();
  const t = d.pochtachi.oxirgiToken(kimga);
  if (t === undefined) throw new Error(`${kimga ?? "hech kim"} ga havolali xat kelmadi`);
  return t;
}

/** #12 oqimi: ro'yxat (202) → xatdagi token → email-tasdiq → sessiya cookie'si. eslabQol — keyin login bilan (tasdiq sessiyasi qisqa) */
export async function hisobOch(app: Parameters<typeof request>[0], d: TestAuth, email: string, nom = email.split("@")[0] ?? "x"): Promise<string> {
  await request(app).post("/v1/auth/royxat").send({ email, toliqIsm: nom, parol: PAROL }).expect(202);
  const token = await xatToken(d, email);
  const r = await request(app).post("/v1/auth/email-tasdiq").send({ token }).expect(200);
  return cookieniOl(r.headers["set-cookie"]);
}
