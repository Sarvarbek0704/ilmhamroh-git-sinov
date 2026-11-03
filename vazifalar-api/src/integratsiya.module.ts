// integratsiya.module.ts — 30 C bosqich: 29-qism B integratsiyalari Nest modulida — fayllar (MinIO), bildirishnomalar + push + SMS callback,
// one-click obuna, Telegram ulash, webhook obunalari, SSE /v1/oqim, muddat/eslatma (BullMQ producer). Har biri ixtiyoriy (29: "berilmasa yo'llar yo'q"):
//   - testlar tayyor bog'liqlik beradi (`IntegratsiyaSozlamasi`) — faqat berilganlari yoqiladi;
//   - main.ts (config'dan) — controller'lar ro'yxati config bo'yicha SINXRON aniqlanadi (Nest modul metama'lumoti statik), bog'liqliklar esa async
//     fabrikalar (S3 bucket tayyorlash, Redis subscriber ulanishi) — xato bo'lsa ilova TURMAYDI (fail-fast, 29 server.ts dagidek).
// Worker'lar (eslatma, yetkazish, relay) API'da EMAS — alohida jarayon `src/ishchi.ts` (29 qarori; Nest'siz — natijalar/tajriba/tC-bullmq.txt).
import { Global, Inject, Injectable, Module } from "@nestjs/common";
import type { BeforeApplicationShutdown, DynamicModule, OnApplicationShutdown, Provider, Type } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { Config } from "./config.ts";
import type { Log } from "./umumiy/log.ts";
import type { Sirlar } from "./umumiy/sir.ts";
import type { Xabarchi } from "./umumiy/webhook.ts";
import { ClsService } from "nestjs-cls";
import { BILDIRISHNOMA, CLS_EGASI, CONFIG, FAYLLAR, JONLI, LOG, NAVBATLAR, OBUNA_KALITI, SIRLAR, TELEGRAM_ULASH, WEBHOOKLAR } from "./tokenlar.ts";
import { SAQLASH } from "./ombor.module.ts";
import type { Saqlash } from "./ombor-yarat.ts";
import { FaylOmbori } from "./fayl/s3.ts";
import { FayllarController, IlovalarController, type FaylBogliqliklari } from "./fayl/fayl.controller.ts";
import { BildirishnomalarController, PushController, SmsController, type BildirishnomaBogliqliklari } from "./bildirishnoma/bildirishnoma.controller.ts";
import { ObunaController } from "./email/obuna.controller.ts";
import { TelegramController, type TelegramUlashSozlamasi } from "./telegram/telegram.controller.ts";
import { WebhooklarController, type WebhookSozlamasi } from "./webhook/webhook.controller.ts";
import { OqimController } from "./realtime/oqim.controller.ts";
import { RedisTarqatuvchi, SseHub } from "./realtime/sse.ts";
import { jonliXabarchi } from "./realtime/jonli.ts";
import { MuddatController, type NavbatSozlamasi } from "./navbat/navbat.controller.ts";
import { Navbatlar, ulanish } from "./navbat/navbat.ts";
import { HODISA } from "./vazifalar/vazifalar.service.ts";
import type { StatistikaBogliqliklari } from "./statistika/statistika.module.ts";
import type { AiBogliqliklari } from "./ai/ai.module.ts";

export type IntegratsiyaSozlamasi = {
  fayllar?: FaylBogliqliklari | undefined;
  bildirishnoma?: BildirishnomaBogliqliklari | undefined;
  obunaKaliti?: Buffer | undefined;
  telegram?: TelegramUlashSozlamasi | undefined;
  webhooklar?: WebhookSozlamasi | undefined;
  jonli?: SseHub | undefined;
  navbat?: NavbatSozlamasi | undefined;
  /** holat 38 (outbox'siz, bitta nusxa) — vazifa hodisasi → SSE to'g'ridan; testlar va Redis/ishchi yo'q lokal rejim */
  xabarchiFabrika?: ((egasi: number) => Xabarchi) | undefined;
  /** 31-qism #05/#09: hodisalar statistikasi (testlar pool beradi; config rejimida — postgres/prisma bo'lsa) */
  statistika?: StatistikaBogliqliklari | undefined;
  /** 31-qism #13–#20: AI (testlar soxta provayder beradi; config rejimida — AI_PROVAYDER != yoq va postgres/prisma) */
  ai?: AiBogliqliklari | undefined;
};

/** Ichki: config rejimida bog'liqliklar va jonli subscriber (yopish uchun) */
type JonliTayyor = { hub: SseHub; yop: () => void };
const JONLI_TAYYOR = Symbol("JONLI_TAYYOR");
const XABARCHI_FABRIKA = Symbol("XABARCHI_FABRIKA");

/** holat 35–38 dagi "xabarchi" yo'li (outbox'siz): VazifalarService hodisalari (EventEmitter2) → foydalanuvchi xabarchisi. Egasi — hodisaning 2-argumenti */
@Injectable()
class XabarchiTinglovchi {
  constructor(@Inject(XABARCHI_FABRIKA) private readonly fabrika: ((egasi: number) => Xabarchi) | null, private readonly cls: ClsService) {}

  #yubor(hodisa: "vazifa.yaratildi" | "vazifa.yangilandi" | "vazifa.bajarildi" | "vazifa.ochirildi", v: unknown, egasi: unknown): void {
    const e = typeof egasi === "number" ? egasi : this.cls.get<number | undefined>(CLS_EGASI);
    if (this.fabrika === null || e === undefined) return;
    this.fabrika(e)(hodisa, v as Parameters<Xabarchi>[1]);
  }

  @OnEvent(HODISA.yaratildi) yaratildi(v: unknown, e: unknown): void { this.#yubor("vazifa.yaratildi", v, e); }
  @OnEvent(HODISA.yangilandi) yangilandi(v: unknown, e: unknown): void { this.#yubor("vazifa.yangilandi", v, e); }
  @OnEvent(HODISA.bajarildi) bajarildi(v: unknown, e: unknown): void { this.#yubor("vazifa.bajarildi", v, e); }
  @OnEvent(HODISA.ochirildi) ochirildi(v: unknown, e: unknown): void { this.#yubor("vazifa.ochirildi", v, e); }
}

/** Yopish: SSE hub (ulanishlar) — main.ts jarayonniBoshqar `boshida` da ham; navbat producer ulanishi; jonli subscriber */
@Injectable()
class IntegratsiyaYopuvchi implements BeforeApplicationShutdown, OnApplicationShutdown {
  constructor(@Inject(JONLI_TAYYOR) private readonly jonli: JonliTayyor | null, @Inject(NAVBATLAR) private readonly navbat: NavbatSozlamasi | null, @Inject(LOG) private readonly log: Log) {}
  beforeApplicationShutdown(): void {
    this.jonli?.yop();
  }
  async onApplicationShutdown(): Promise<void> {
    await this.navbat?.navbatlar.yop().catch((err: unknown) => { this.log.warn({ err }, "navbat yopilmadi"); });
  }
}

export type ConfigRejimi = { config: Config; authYoqilgan: boolean };

/** config bo'yicha qaysi integratsiyalar yoqiladi (sinxron — controller ro'yxati uchun) */
export function yoqilganlar({ config: c, authYoqilgan }: ConfigRejimi) {
  const pg = (c.SAQLASH === "postgres" || c.SAQLASH === "prisma") && authYoqilgan;
  return {
    fayllar: pg && c.S3_BUCKET !== undefined && c.S3_KALIT !== undefined && c.S3_SIR !== undefined,
    bildirishnoma: pg,
    obuna: authYoqilgan,
    telegram: pg && c.TELEGRAM_BOT_NOMI !== undefined && c.REDIS_URL !== undefined,
    webhooklar: pg,
    jonli: pg,
    navbat: pg && c.REDIS_URL !== undefined,
  };
}

const pool = (s: Saqlash) => {
  if (s.pool === undefined) throw new Error("integratsiya: ma'lumot pool'i yo'q (SAQLASH=postgres|prisma kerak)");
  return s.pool;
};

@Global()
@Module({})
export class IntegratsiyaModule {
  static forRoot(o: IntegratsiyaSozlamasi, configRejimi?: ConfigRejimi): DynamicModule {
    const y = configRejimi === undefined ? undefined : yoqilganlar(configRejimi);
    const controllers: Type[] = [];
    const providers: Provider[] = [XabarchiTinglovchi, IntegratsiyaYopuvchi];
    const qiymat = (token: symbol, v: unknown) => providers.push({ provide: token, useValue: v ?? null });

    // --- fayllar (S3/MinIO): bucket yo'q bo'lsa yaratiladi (lokal; prodda — infra)
    if (o.fayllar !== undefined || y?.fayllar === true) controllers.push(IlovalarController, FayllarController);
    if (o.fayllar !== undefined || y?.fayllar !== true) qiymat(FAYLLAR, o.fayllar);
    else providers.push({
      provide: FAYLLAR, inject: [CONFIG, SAQLASH],
      useFactory: async (c: Config, s: Saqlash): Promise<FaylBogliqliklari> => {
        const ombor = new FaylOmbori({ ...(c.S3_ENDPOINT === undefined ? {} : { endpoint: c.S3_ENDPOINT }), region: c.S3_REGION, kalit: c.S3_KALIT ?? "", sir: c.S3_SIR ?? "", bucket: c.S3_BUCKET ?? "" });
        await ombor.tayyorla();
        return { ombor, pool: pool(s), maksHajm: c.FAYL_MAKS_MB * 1024 * 1024 };
      },
    });

    // --- bildirishnomalar, push, SMS callback
    if (o.bildirishnoma !== undefined || y?.bildirishnoma === true) controllers.push(BildirishnomalarController, PushController, SmsController);
    if (o.bildirishnoma !== undefined || y?.bildirishnoma !== true) qiymat(BILDIRISHNOMA, o.bildirishnoma);
    else providers.push({ provide: BILDIRISHNOMA, inject: [CONFIG, SAQLASH, SIRLAR], useFactory: (c: Config, s: Saqlash, sir: Sirlar): BildirishnomaBogliqliklari => ({ pool: pool(s), vapidOchiq: c.VAPID_OCHIQ, smsKaliti: sir.kalit("sms") }) });

    // --- one-click obuna (auth pool'i — AUTH dan)
    if (o.obunaKaliti !== undefined || y?.obuna === true) controllers.push(ObunaController);
    if (o.obunaKaliti !== undefined || y?.obuna !== true) qiymat(OBUNA_KALITI, o.obunaKaliti);
    else providers.push({ provide: OBUNA_KALITI, inject: [SIRLAR], useFactory: (sir: Sirlar): Buffer => sir.kalit("obuna") });

    // --- Telegram ulash (Redis — kesh klientining o'zi, ikkinchi ulanish yo'q)
    if (o.telegram !== undefined || y?.telegram === true) controllers.push(TelegramController);
    if (o.telegram !== undefined || y?.telegram !== true) qiymat(TELEGRAM_ULASH, o.telegram);
    else providers.push({
      provide: TELEGRAM_ULASH, inject: [CONFIG, SAQLASH],
      useFactory: (c: Config, s: Saqlash): TelegramUlashSozlamasi => {
        if (s.redis === undefined) throw new Error("integratsiya: Telegram ulash uchun REDIS_URL kerak");
        return { pool: pool(s), redis: s.redis, botNomi: c.TELEGRAM_BOT_NOMI ?? "" };
      },
    });

    // --- webhook obunalari
    if (o.webhooklar !== undefined || y?.webhooklar === true) controllers.push(WebhooklarController);
    if (o.webhooklar !== undefined || y?.webhooklar !== true) qiymat(WEBHOOKLAR, o.webhooklar);
    else providers.push({ provide: WEBHOOKLAR, inject: [CONFIG, SAQLASH], useFactory: (c: Config, s: Saqlash): WebhookSozlamasi => ({ pool: pool(s), httpRuxsat: c.NODE_ENV !== "production" }) });

    // --- SSE /v1/oqim: Redis bor — Stream (tarix) + Pub/Sub (ko'p nusxa; subscriber — ALOHIDA ulanish, node-redis talabi). Yo'q — bitta nusxa
    if (o.jonli !== undefined || y?.jonli === true) controllers.push(OqimController);
    if (o.jonli !== undefined || y?.jonli !== true) {
      qiymat(JONLI_TAYYOR, o.jonli === undefined ? null : { hub: o.jonli, yop: () => undefined });
    } else {
      providers.push({
        provide: JONLI_TAYYOR, inject: [SAQLASH, LOG],
        useFactory: async (s: Saqlash, log: Log): Promise<JonliTayyor> => {
          const tarqatuvchi = s.redis === undefined ? undefined : new RedisTarqatuvchi(s.redis);
          const hub = new SseHub(tarqatuvchi === undefined ? {} : { tarix: tarqatuvchi.tarix() });
          const sub = s.redis?.duplicate();
          if (sub !== undefined) {
            sub.on("error", (err) => { log.error({ err }, "redis (jonli sub): ulanish xatosi"); });
            await sub.connect();
            await RedisTarqatuvchi.tingla(sub, hub);
          }
          return { hub, yop: () => { hub.yop(); sub?.destroy(); } };
        },
      });
    }
    providers.push({ provide: JONLI, inject: [JONLI_TAYYOR], useFactory: (j: JonliTayyor | null): SseHub | null => j?.hub ?? null });

    // --- BullMQ producer (API faqat ish qo'shadi; worker'lar — src/ishchi.ts). Redis — node-redis (navbat.ts: clientFactory)
    if (o.navbat !== undefined || y?.navbat === true) controllers.push(MuddatController);
    if (o.navbat !== undefined || y?.navbat !== true) qiymat(NAVBATLAR, o.navbat);
    else providers.push({ provide: NAVBATLAR, inject: [CONFIG, SAQLASH], useFactory: (c: Config, s: Saqlash): NavbatSozlamasi => ({ pool: pool(s), navbatlar: new Navbatlar(ulanish(c.REDIS_URL ?? "")) }) });

    // holat 38 yo'li (testlar): xabarchi to'g'ridan. config rejimida — outbox (repository tranzaksiyasi) + ishchi relay; Redis/ishchi yo'q bo'lsa
    // (29 server.ts dagidek) — hodisa SSE'ga to'g'ridan hub'ga
    if (y?.jonli === true && !y.navbat && o.xabarchiFabrika === undefined) {
      providers.push({ provide: XABARCHI_FABRIKA, inject: [JONLI_TAYYOR, LOG], useFactory: (j: JonliTayyor, log: Log) => jonliXabarchi({ hub: j.hub, log: () => log }) });
    } else qiymat(XABARCHI_FABRIKA, o.xabarchiFabrika);
    return { module: IntegratsiyaModule, controllers, providers, exports: [FAYLLAR, BILDIRISHNOMA, OBUNA_KALITI, TELEGRAM_ULASH, WEBHOOKLAR, JONLI, NAVBATLAR] };
  }
}
