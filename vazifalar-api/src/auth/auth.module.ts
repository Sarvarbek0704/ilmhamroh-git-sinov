// auth.module.ts — B bosqich: auth dinamik moduli. AUTH provider'i: tayyor bog'liqliklar (testlar) yoki config'dan fabrika (main.ts) — postgres/prisma
// pool'i bo'lsa (SAQLASH.pool); auth uchun ALOHIDA pool — AUTH_DATABASE_URL (vazifalar_auth roli, 28 #20) berilsa. Yoqilmagan (DEV rejim: xotira/fayl) —
// AUTH = null, controller'lar ro'yxatdan O'TMAYDI (28 dagidek /v1/auth yo'llari 404).
// Lifecycle: yopishda fon xatlari tugashi kutiladi (beforeApplicationShutdown), alohida auth pool yopiladi
import { Global, Inject, Injectable, Module } from "@nestjs/common";
import type { BeforeApplicationShutdown, DynamicModule, OnApplicationShutdown, Provider } from "@nestjs/common";
import { AUTH, CONFIG, LOG, POCHTA, SIRLAR } from "../tokenlar.ts";
import { Pochta } from "../email/pochta.ts";
import type { Config } from "../config.ts";
import type { Log } from "../umumiy/log.ts";
import type { Sirlar } from "../umumiy/sir.ts";
import { pgPool } from "../vazifalar/pg-ombor.ts";
import { SAQLASH } from "../ombor.module.ts";
import type { Saqlash } from "../ombor-yarat.ts";
import { authYarat } from "./auth-yarat.ts";
import type { AuthBogliqliklari } from "./xizmat.ts";
import { AuthService } from "./auth.service.ts";
import { AuthController } from "./auth.controller.ts";
import { MfaController } from "./mfa.controller.ts";
import { AdminController } from "./admin.controller.ts";

/** shu modul O'ZI ochgan pool'lar (AUTH_DATABASE_URL) — faqat ularni yopamiz: testlar bergan tayyor auth'ning pool'i test faylniki */
const ozimizniki = new WeakSet<object>();

/**
 * 30 C (29-qism B holat 13): SMTP — async fabrika: ishga tushishda verify() (ulanish/auth xato bo'lsa ilova TURMAYDI: xatsiz ro'yxat — jim nosozlik).
 * SMTP_HOST yo'q — null (dev: xatlar log'ga). production'da 587 + requireTLS
 */
const pochtaProvider: Provider = {
  provide: POCHTA,
  inject: [CONFIG],
  useFactory: async (c: Config): Promise<Pochta | null> => {
    if (c.SMTP_HOST === undefined) return null;
    const p = new Pochta({
      host: c.SMTP_HOST, port: c.SMTP_PORT, secure: c.SMTP_SECURE, requireTLS: c.NODE_ENV === "production" && !c.SMTP_SECURE,
      ...(c.SMTP_USER === undefined || c.SMTP_PASS === undefined ? {} : { user: c.SMTP_USER, pass: c.SMTP_PASS }), from: c.SMTP_FROM,
    });
    await p.tekshir();
    return p;
  },
};

@Injectable()
class AuthYopuvchi implements BeforeApplicationShutdown, OnApplicationShutdown {
  constructor(@Inject(AUTH) private readonly auth: AuthBogliqliklari | null, @Inject(POCHTA) private readonly pochta: Pochta | null) {}

  async beforeApplicationShutdown(): Promise<void> {
    await this.auth?.fon.tugashi();
  }

  async onApplicationShutdown(): Promise<void> {
    this.pochta?.yop();
    // alohida auth pool (AUTH_DATABASE_URL) — ma'lumot pool'i emas (u OmborModule'da yopiladi)
    if (this.auth !== null && ozimizniki.has(this.auth.pool)) await this.auth.pool.end();
  }
}

export type AuthModulSozlamasi = { yoqilgan: boolean; auth?: AuthBogliqliklari | undefined };

@Global()
@Module({})
export class AuthModule {
  static forRoot({ yoqilgan, auth }: AuthModulSozlamasi): DynamicModule {
    const authProvider: Provider = auth !== undefined ? { provide: AUTH, useValue: auth }
      : !yoqilgan ? { provide: AUTH, useValue: null }
      : {
        provide: AUTH,
        inject: [SAQLASH, CONFIG, LOG, SIRLAR, POCHTA],
        useFactory: (s: Saqlash, c: Config, log: Log, sirlar: Sirlar, pochta: Pochta | null): AuthBogliqliklari | null => {
          if (s.pool === undefined) return null;
          const pool = c.AUTH_DATABASE_URL === undefined ? s.pool
            : pgPool(c.AUTH_DATABASE_URL, { max: 5, application_name: "vazifalar-api-auth", idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, statement_timeout: c.PG_STATEMENT_TIMEOUT });
          if (pool !== s.pool) ozimizniki.add(pool);
          if (pool !== s.pool) pool.on("error", (err) => { log.error({ err }, "pg pool (auth): bo'sh ulanish uzildi"); });
          return authYarat(pool, c, sirlar, log, pochta, s.redis);
        },
      };
    return {
      module: AuthModule,
      controllers: yoqilgan ? [AuthController, MfaController, AdminController] : [],
      // tayyor auth (testlar) yoki DEV — SMTP yo'q (testlar o'z pochtachisini beradi; process.env dagi SMTP_* ga ulanmaydi)
      providers: [authProvider, auth === undefined && yoqilgan ? pochtaProvider : { provide: POCHTA, useValue: null }, AuthYopuvchi, ...(yoqilgan ? [AuthService] : [])],
      exports: [AUTH, POCHTA],
    };
  }
}
