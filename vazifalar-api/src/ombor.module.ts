// ombor.module.ts — dinamik modul (#12): OMBOR_FABRIKASI (foydalanuvchi id → ombor) va VAZIFA_OMBORI (dev/health uchun — EGASI_ID ombori).
//   forRoot(ombor)  — tayyor obyekt yoki fabrika (testlar) — useValue, yopish chaqiruvchining ishi;
//   forRootAsync()  — config bo'yicha (SAQLASH=xotira|fayl|postgres|prisma, REDIS_URL): ASYNC fabrika provider (#09) — Nest bootstrap
//                     paytida Promise'ni kutadi (baza ulanishi, migratsiya tekshiruvi — fail-fast), ilova yopilganda pool/redis yopiladi (#13).
// B bosqich (28-qism): postgres/prisma — har so'rov o'z egasi bilan (fabrika); SAQLASH eksport qilinadi — auth pool'i shundan
import { Global, Inject, Injectable, Module } from "@nestjs/common";
import type { DynamicModule, OnApplicationShutdown } from "@nestjs/common";
import { omborOl, omborYarat } from "./ombor-yarat.ts";
import type { Saqlash } from "./ombor-yarat.ts";
import type { Config } from "./config.ts";
import type { Log } from "./umumiy/log.ts";
import { CONFIG, LOG, OMBOR_FABRIKASI, VAZIFA_OMBORI } from "./tokenlar.ts";
import type { OmborFabrikasi, VazifaOmbori } from "./vazifalar/ombor.ts";

export const SAQLASH = Symbol("SAQLASH");

/** Lifecycle hook (#13): onApplicationShutdown — HTTP server yopilgandan KEYIN (boshlangan so'rovlar bazani ishlatib bo'lgach) chaqiriladi */
@Injectable()
class SaqlashYopuvchi implements OnApplicationShutdown {
  constructor(@Inject(SAQLASH) private readonly saqlash: Saqlash, @Inject(LOG) private readonly log: Log) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    await this.saqlash.yop();
    this.log.info({ signal }, "ombor ulanishlari yopildi");
  }
}

const fabrikaga = (o: VazifaOmbori | OmborFabrikasi): OmborFabrikasi => (typeof o === "function" ? o : () => o);
const ikkalasi = [
  { provide: OMBOR_FABRIKASI, useFactory: (s: Saqlash): OmborFabrikasi => fabrikaga(s.ombor), inject: [SAQLASH] },
  { provide: VAZIFA_OMBORI, useFactory: (s: Saqlash, c: Config): VazifaOmbori => omborOl(s, c.EGASI_ID), inject: [SAQLASH, CONFIG] },
];

@Global()
@Module({})
export class OmborModule {
  /** tayyor ombor (xotira — testlar) yoki fabrika (`(egasi) => new PgOmbori(pool, egasi)`) */
  static forRoot(ombor: VazifaOmbori | OmborFabrikasi): DynamicModule {
    return {
      module: OmborModule,
      providers: [{ provide: SAQLASH, useValue: { ombor, yop: () => Promise.resolve() } satisfies Saqlash }, ...ikkalasi],
      exports: [SAQLASH, OMBOR_FABRIKASI, VAZIFA_OMBORI],
    };
  }

  static forRootAsync(): DynamicModule {
    return {
      module: OmborModule,
      providers: [
        // async fabrika: Nest Promise'ni kutadi; xato bo'lsa — ilova ishga TUSHMAYDI (baza yo'q, migratsiya orqada)
        { provide: SAQLASH, useFactory: (config: Config, log: Log): Promise<Saqlash> => omborYarat(config, log), inject: [CONFIG, LOG] },
        ...ikkalasi,
        SaqlashYopuvchi,
      ],
      exports: [SAQLASH, OMBOR_FABRIKASI, VAZIFA_OMBORI],
    };
  }
}
