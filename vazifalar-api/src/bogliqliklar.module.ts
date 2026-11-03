// bogliqliklar.module.ts — ilovaning umumiy bog'liqliklari (global): config, log, xabarchi, sozlamalar, idempotentlik ombori.
// Holat 30: config @nestjs/config orqali (#27/#28) — registerAs("ilova") fabrikasi 25-qism configYukla() (Zod, fail-fast) ni chaqiradi;
// boshqa provider'lar config'dan fabrika bilan quriladi. Testlar tayyor qiymat berishi mumkin (config, log, xabarchi, tz)
import { Global, Module } from "@nestjs/common";
import type { DynamicModule, Provider } from "@nestjs/common";
import { ConfigModule, registerAs } from "@nestjs/config";
import type { ConfigType } from "@nestjs/config";
import { CONFIG, ICHKI_SIR, IDEMPOTENTLIK_OMBORI, ILOVA_SOZLAMALARI, KURSOR_KALITI, LOG, SIRLAR, XABARCHI } from "./tokenlar.ts";
import { Sirlar } from "./umumiy/sir.ts";
import type { IlovaSozlamalari } from "./tokenlar.ts";
import { configYukla } from "./config.ts";
import type { Config } from "./config.ts";
import { logYarat } from "./umumiy/log.ts";
import type { Log } from "./umumiy/log.ts";
import type { Xabarchi } from "./umumiy/webhook.ts";
import type { IdempotentlikOmbori } from "./umumiy/idempotentlik.ts";

export type TashqiBogliqliklar = {
  /** berilmasa — process.env dan (configYukla); xato bo'lsa ConfigXatosi — ilova yaratilmaydi */
  config?: Config | undefined;
  log?: Log | undefined;
  xabarchi?: Xabarchi | undefined;
  tz?: string | undefined;
  idempotentlikOmbori: IdempotentlikOmbori;
  /** B: kursor HMAC kaliti (berilmasa — ILOVA_SIRI dan HKDF) va servislararo HMAC siri (berilmasa — ICHKI_HMAC_SIRI) */
  kursorKaliti?: Buffer | undefined;
  ichkiSir?: Buffer | undefined;
};

@Global()
@Module({})
export class BogliqliklarModule {
  static forRoot({ config, log, xabarchi, tz, idempotentlikOmbori, kursorKaliti, ichkiSir }: TashqiBogliqliklar): DynamicModule {
    // Nomlangan config bo'limi (namespace): ConfigService.get("ilova") yoki @Inject(ilova.KEY) — ConfigType<typeof ilova> bilan tipli
    const ilova = registerAs("ilova", (): Config => config ?? configYukla(process.env));
    const providers: Provider[] = [
      { provide: CONFIG, useFactory: (c: ConfigType<typeof ilova>): Config => c, inject: [ilova.KEY] },
      { provide: LOG, useFactory: (c: Config): Log => log ?? logYarat(c.LOG_LEVEL), inject: [CONFIG] },
      {
        provide: XABARCHI,
        // 30 C (29-qism B holat 35): global WEBHOOK_URL olib tashlandi — foydalanuvchi obunalari (webhook_obunalari) + outbox + ishchi.
        // Bu token endi faqat testlar bergan xabarchi uchun (25-qism shartnomasi: "bajarildi" — mock darsi)
        useFactory: (): Xabarchi | null => xabarchi ?? null,
      },
      { provide: ILOVA_SOZLAMALARI, useFactory: (c: Config): IlovaSozlamalari => ({ tz: tz ?? c.APP_TZ }), inject: [CONFIG] },
      { provide: IDEMPOTENTLIK_OMBORI, useValue: idempotentlikOmbori },
      {
        provide: SIRLAR, inject: [CONFIG, LOG],
        useFactory: (c: Config, l: Log): Sirlar => {
          const s = new Sirlar(c.ILOVA_SIRI);
          if (s.vaqtinchalik) l.warn("ILOVA_SIRI berilmagan — vaqtinchalik tasodifiy sir (dev): qayta ishga tushsa SMS kodlar, kursorlar va OIDC holatlari yaroqsiz");
          return s;
        },
      },
      { provide: KURSOR_KALITI, inject: [SIRLAR], useFactory: (s: Sirlar): Buffer => kursorKaliti ?? s.kalit("kursor") },
      { provide: ICHKI_SIR, inject: [CONFIG], useFactory: (c: Config): Buffer | null => ichkiSir ?? (c.ICHKI_HMAC_SIRI === undefined ? null : Buffer.from(c.ICHKI_HMAC_SIRI)) },
    ];
    return {
      module: BogliqliklarModule,
      // ignoreEnvFile: .env ni Node o'zi o'qiydi (node --env-file-if-exists=.env) — dotenv ikkinchi marta o'qimasin; isGlobal — ConfigService hamma joyda
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, cache: true, load: [ilova] })],
      providers,
      exports: [CONFIG, LOG, XABARCHI, ILOVA_SOZLAMALARI, IDEMPOTENTLIK_OMBORI, SIRLAR, KURSOR_KALITI, ICHKI_SIR],
    };
  }
}
