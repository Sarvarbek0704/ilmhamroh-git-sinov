// salomatlik.module.ts — #51 NS-50: orkestrator (Docker healthcheck, Kubernetes probe, 33–34-qism) uchun endpoint'lar — @nestjs/terminus.
//   GET /health/live  — jarayon tirikmi (tekshiruvsiz: javob berdimi — yetarli; bazaga bog'lamang — baza uzilsa qayta ishga tushirish yordam bermaydi)
//   GET /health/ready — so'rov qabul qilishga tayyormi: ombor (baza) 2 s ichida javob beradi, heap 512 MB dan kam. Yo'q bo'lsa — 503
// Versiyasiz (VERSION_NEUTRAL): /v1 ga bog'liq emas
import { Controller, Get, Global, Inject, Injectable, Module, ServiceUnavailableException, VERSION_NEUTRAL } from "@nestjs/common";
import { HealthCheck, HealthCheckService, HealthIndicatorService, MemoryHealthIndicator, TerminusModule } from "@nestjs/terminus";
import type { HealthCheckResult, HealthIndicatorResult } from "@nestjs/terminus";
import { ILOVA_HOLATI, IlovaHolati, VAZIFA_OMBORI } from "../tokenlar.ts";
import { Ochiq } from "../auth/qoriqchi.ts";
import type { VazifaOmbori } from "../vazifalar/ombor.ts";

/** O'z indikatorimiz: ombor turi muhim emas (xotira, fayl, Postgres, Prisma, kesh) — VazifaOmbori.soni() javob beradimi */
@Injectable()
export class OmborIndikatori {
  constructor(private readonly indikator: HealthIndicatorService, @Inject(VAZIFA_OMBORI) private readonly ombor: VazifaOmbori) {}

  async tekshir<K extends string>(kalit: K, kutishMs = 2000): Promise<HealthIndicatorResult<K>> {
    const seans = this.indikator.check(kalit);
    const t = performance.now();
    try {
      await Promise.race([this.ombor.soni({}), new Promise((_, rad) => setTimeout(() => { rad(new Error(`${String(kutishMs)} ms ichida javob yo'q`)); }, kutishMs).unref())]);
      return seans.up({ ms: Math.round(performance.now() - t) });
    } catch (x) {
      return seans.down({ xato: x instanceof Error ? x.message : String(x) });
    }
  }
}

// B: health — kirishsiz (load balancer, k8s probe): global KirishGuard "yopiq sukut" — aniq @Ochiq()
@Controller({ path: "health", version: VERSION_NEUTRAL })
@Ochiq()
export class SalomatlikController {
  constructor(private readonly salomatlik: HealthCheckService, private readonly ombor: OmborIndikatori, private readonly xotira: MemoryHealthIndicator, @Inject(ILOVA_HOLATI) private readonly holat: IlovaHolati) {}

  @Get("live")
  @HealthCheck()
  tirik(): Promise<HealthCheckResult> {
    return this.salomatlik.check([]);
  }

  /** 31 #27: startup probe — ishga tushish (migratsiya tekshiruvi, bog'liqliklar) tugadimi; sekin startda liveness jarayonni o'ldirmasin */
  @Get("startup")
  @HealthCheck()
  boshlandi(): Promise<HealthCheckResult> {
    if (!this.holat.boshlandi) throw new ServiceUnavailableException({ status: "error", info: {}, error: { boshlanish: { status: "down" } }, details: {} });
    return this.salomatlik.check([]);
  }

  @Get("ready")
  @HealthCheck()
  tayyor(): Promise<HealthCheckResult> {
    // 31 #26: SIGTERM kelgan — tayyor EMAS (balanser trafikni boshqa nusxaga buradi), boshlangan so'rovlar esa tugaydi
    if (this.holat.yopilmoqda) throw new ServiceUnavailableException({ status: "error", info: {}, error: { yopilish: { status: "down" } }, details: {} });
    return this.salomatlik.check([() => this.ombor.tekshir("ombor"), () => this.xotira.checkHeap("xotira", 512 * 1024 * 1024)]);
  }
}

@Global()
@Module({ imports: [TerminusModule], controllers: [SalomatlikController], providers: [OmborIndikatori, { provide: ILOVA_HOLATI, useValue: new IlovaHolati() }], exports: [ILOVA_HOLATI] })
export class SalomatlikModule {}
