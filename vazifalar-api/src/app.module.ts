// app.module.ts — ildiz modul: ilova shu moduldan boshlab yig'iladi (imports daraxti).
// forRoot(...) — dinamik modul: ombor tayyor berilsa (testlar) — shu, aks holda config bo'yicha OmborModule.forRootAsync() yaratadi.
// Holat 30: @nestjs/config (BogliqliklarModule ichida), nestjs-pino (Nest'ning o'z logi — JSON, bizning pino orqali), nestjs-cls (so'rov konteksti)
import { Module } from "@nestjs/common";
import type { DynamicModule, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { ClsModule } from "nestjs-cls";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ScheduleModule } from "@nestjs/schedule";
import { SalomatlikModule } from "./salomatlik/salomatlik.module.ts";
import { BogliqliklarModule } from "./bogliqliklar.module.ts";
import type { TashqiBogliqliklar } from "./bogliqliklar.module.ts";
import { OmborModule } from "./ombor.module.ts";
import { VazifalarModule } from "./vazifalar/vazifalar.module.ts";
import { EksportModule } from "./eksport/eksport.module.ts";
import { SxemaPipe } from "./umumiy/sxema.pipe.ts";
import { JsonTanaGuard } from "./umumiy/json-tana.guard.ts";
import { ProblemDetailsFilter } from "./umumiy/problem.filter.ts";
import { eskirgan, ESKI_YOLLAR } from "./umumiy/eskirgan.ts";
import type { OmborFabrikasi, VazifaOmbori } from "./vazifalar/ombor.ts";
import { LOG } from "./tokenlar.ts";
import { configYukla } from "./config.ts";
import { AuthModule } from "./auth/auth.module.ts";
import type { AuthBogliqliklari } from "./auth/xizmat.ts";
import { KirishGuard } from "./auth/qoriqchi.ts";
import { CaptchaGuard, CheklovGuard } from "./auth/cheklov.guard.ts";
import { IchkiController, ServisImzoGuard } from "./auth/ichki.controller.ts";
import type { Log } from "./umumiy/log.ts";
import { IntegratsiyaModule } from "./integratsiya.module.ts";
import { yoqilganlar } from "./integratsiya.module.ts";
import type { IntegratsiyaSozlamasi } from "./integratsiya.module.ts";
import { StatistikaModule } from "./statistika/statistika.module.ts";
import { BayroqlarModule } from "./bayroq/bayroqlar.ts";
import { AuditController, AuditInterceptor } from "./audit/audit.ts";
import { AiModule, aiYoqilganmi } from "./ai/ai.module.ts";

export type IlovaBogliqliklari = TashqiBogliqliklar & {
  /** tayyor ombor yoki foydalanuvchi bo'yicha fabrika (testlar); berilmasa — config bo'yicha */
  ombor?: VazifaOmbori | OmborFabrikasi | undefined;
  /** B: tayyor auth bog'liqliklari (testlar); berilmasa — config: SAQLASH=postgres/prisma bo'lsa yoqiladi */
  auth?: AuthBogliqliklari | undefined;
  /** C (29-qism integratsiyalari): testlar tayyor bog'liqlik beradi; berilmasa (main.ts) — config bo'yicha */
  integratsiya?: IntegratsiyaSozlamasi | undefined;
};

@Module({})
export class AppModule implements NestModule {
  static forRoot({ ombor, auth, integratsiya = {}, ...b }: IlovaBogliqliklari): DynamicModule {
    // config bu yerda (sinxron) ham kerak: auth yoqilganmi — controller'lar ro'yxati statik. ConfigXatosi shu yerda — ilovaYarat rad etiladi (main: exit 78)
    const config = b.config ?? configYukla(process.env);
    const authYoqilgan = auth !== undefined || (ombor === undefined && (config.SAQLASH === "postgres" || config.SAQLASH === "prisma"));
    return {
      module: AppModule,
      imports: [
        BogliqliklarModule.forRoot({ ...b, config }),
        // #29: Nest tizim loglari (bootstrap, ExceptionHandler) — bizning pino orqali JSON. useExisting: pino-http'ni o'zimiz app.use bilan ulaganmiz
        // (ilova.ts) — u Nest marshrutlaridan OLDIN: statik fayl, 400/413 JSON xatosi, 404 ham loglanadi (t29 — nestjs-pino o'z middleware'i bilan bularni loglamaydi)
        LoggerModule.forRootAsync({ inject: [LOG], useFactory: (log: Log) => ({ pinoHttp: { logger: log }, useExisting: true }) }),
        // #30: so'rov konteksti (AsyncLocalStorage) — middleware'ni ilova.ts da app.use bilan erta ulaymiz (mount: false)
        ClsModule.forRoot({ global: true, middleware: { mount: false } }),
        // #49: domen hodisalari (wildcard — SSE "vazifa.*" uchun), #48: @Interval/@Cron
        EventEmitterModule.forRoot({ wildcard: true, delimiter: "." }),
        ScheduleModule.forRoot(),
        ombor === undefined ? OmborModule.forRootAsync() : OmborModule.forRoot(ombor),
        AuthModule.forRoot({ yoqilgan: authYoqilgan, auth }),
        // config rejimi — faqat ombor ham config'dan bo'lsa (main.ts); testlar o'zi bergan integratsiyalar bilan
        IntegratsiyaModule.forRoot(integratsiya, ombor === undefined ? { config, authYoqilgan } : undefined),
        // 31 #05/#09: hodisalar statistikasi va bo'limlar (config rejimida — faqat postgres/prisma + auth)
        StatistikaModule.forRoot(integratsiya.statistika, ombor === undefined && yoqilganlar({ config, authYoqilgan }).bildirishnoma),
        // 31 #13–#20: AI (vazifani qadamlarga bo'lish …) — config rejimida AI_PROVAYDER != yoq bo'lsa
        AiModule.forRoot(integratsiya.ai, ombor === undefined && aiYoqilganmi(config, authYoqilgan)),
        // 31 #25: feature flag'lar (auth bilan)
        BayroqlarModule.forRoot(authYoqilgan),
        SalomatlikModule,
        VazifalarModule,
        EksportModule,
      ],
      // 31 #23: admin audit jurnali (auth bilan)
      controllers: authYoqilgan ? [IchkiController, AuditController] : [IchkiController],
      // global enhancer'lar DI bilan (#26; tartib — t07; guard'lar RO'YXATDAGI TARTIBDA ishlaydi): kim (401/403) → tezlik (429) → CAPTCHA → 415;
      // Standard Schema tekshiruvi, Problem Details filtri
      providers: [
        ServisImzoGuard,
        { provide: APP_PIPE, useClass: SxemaPipe },
        { provide: APP_GUARD, useClass: KirishGuard },
        { provide: APP_GUARD, useClass: CheklovGuard },
        { provide: APP_GUARD, useClass: CaptchaGuard },
        { provide: APP_GUARD, useClass: JsonTanaGuard },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        // 31 #23: @Audit(...) belgilangan handler muvaffaqiyatli tugasa — audit jurnaliga
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
    };
  }

  // Funksional middleware (#21): eski versiyasiz yo'llar ishlaydi, lekin Deprecation + Sunset + voris havolasi bilan — hamma yo'lga
  // ("*splat" — Express 5 / path-to-regexp 8 sintaksisi; eskirgan() o'zi /vazifalar, /teglar prefiksini tekshiradi)
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(eskirgan(ESKI_YOLLAR)).forRoutes("*splat");
  }
}
