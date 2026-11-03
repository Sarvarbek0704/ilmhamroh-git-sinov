// statistika.module.ts — 31-qism #05/#09: vazifa hodisalari (sql/301 — oyma-oy bo'limli vaqt qatori).
//   GET /v1/statistika/faollik?kunlar=30 — kunlik hodisalar soni (foydalanuvchi mintaqasi bo'yicha kun; bo'lim pruning — vaqt sharti bilan).
//   BolimlarXizmati — ishga tushishda va har kuni 03:00 (UTC) da keyingi 2 oy bo'limlarini oldindan yaratadi (DEFAULT bo'limga tushmasin).
// Faqat SAQLASH=postgres|prisma (auth bilan) — boshqa rejimlarda controller ro'yxatdan o'tmaydi.
import { Controller, Get, Global, Inject, Injectable, Module, Query } from "@nestjs/common";
import type { DynamicModule, OnApplicationBootstrap, Provider, Type } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { Pool } from "pg";
import { z } from "zod";
import { egasiSifatida } from "../umumiy/rls.ts";
import { tekshir } from "../umumiy/tekshir.ts";
import { Egasi } from "../umumiy/egasi.ts";
import { Cheklov } from "../auth/cheklov.guard.ts";
import { API_CHEKLOVI } from "../auth/qoriqchi.ts";
import { ILOVA_SOZLAMALARI, LOG, STATISTIKA } from "../tokenlar.ts";
import type { IlovaSozlamalari } from "../tokenlar.ts";
import type { Log } from "../umumiy/log.ts";
import { SAQLASH } from "../ombor.module.ts";
import type { Saqlash } from "../ombor-yarat.ts";
import { fonXatolari } from "../kuzatuv/metrikalar.ts";

export type StatistikaBogliqliklari = { pool: Pool };

export const HODISA_TURLARI = ["yaratildi", "bajarildi", "qaytarildi", "ochirildi", "tiklandi", "ai_qadamlar", "ai_savol", "semantik_qidiruv"] as const;
const FaollikSorovi = z.strictObject({ kunlar: z.coerce.number().int().min(1).max(366).default(30) });

type Kun = { kun: string } & Partial<Record<(typeof HODISA_TURLARI)[number], number>>;

@Controller("statistika")
@Cheklov(API_CHEKLOVI)
export class StatistikaController {
  constructor(@Inject(STATISTIKA) private readonly b: StatistikaBogliqliklari, @Inject(ILOVA_SOZLAMALARI) private readonly s: IlovaSozlamalari) {}

  @Get("faollik")
  async faollik(@Egasi() fId: number, @Query() q: unknown): Promise<{ tz: string; kunlar: Kun[] }> {
    const { kunlar } = tekshir(FaollikSorovi, q, "query");
    // vaqt sharti — bo'lim kaliti bo'yicha (pruning): faqat oxirgi N kun bo'limlari o'qiladi. Kun chegarasi — foydalanuvchi mintaqasida (APP_TZ)
    const qatorlar = await egasiSifatida(this.b.pool, fId, async (c) => (await c.query<{ kun: string; tur: string; n: number }>(
      `SELECT to_char((vaqt AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS kun, tur, count(*)::int AS n
         FROM vazifa_hodisalari
        WHERE egasi_id = $1 AND vaqt >= ((now() AT TIME ZONE $2)::date - ($3::int - 1)) AT TIME ZONE $2
        GROUP BY 1, 2 ORDER BY 1, 2`, [fId, this.s.tz, kunlar])).rows);
    const jadval = new Map<string, Kun>();
    for (const q2 of qatorlar) {
      const k = jadval.get(q2.kun) ?? { kun: q2.kun };
      k[q2.tur as (typeof HODISA_TURLARI)[number]] = q2.n;
      jadval.set(q2.kun, k);
    }
    return { tz: this.s.tz, kunlar: [...jadval.values()] };
  }
}

/**
 * Bo'limlarni oldindan yaratish (idempotent). 32 #01 (31 nuqsoni): avval xato `warn` bilan YUTILARDI — DEFAULT bo'limda shu oy qatori bo'lsa bo'lim
 * hech qachon yaratilmasdi va buni hech kim bilmasdi. Endi: (1) sql/307 — DEFAULT'dagi qatorlar bitta tranzaksiyada yangi bo'limga ko'chiriladi
 * (bu xato manbaining o'zi yopildi); (2) boshqa har qanday xato — `error` log + `fon_ishlari_xatolari_jami{ish="hodisa-bolimlari"}` metrikasi va
 * `tayyorla()` xatoni QAYTARADI. Ishga tushish va cron uni ushlaydi (ilova to'xtamaydi — DEFAULT bo'lim yozuvni baribir qabul qiladi).
 */
@Injectable()
export class BolimlarXizmati implements OnApplicationBootstrap {
  constructor(@Inject(STATISTIKA) private readonly b: StatistikaBogliqliklari | null, @Inject(LOG) private readonly log: Log) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.tayyorla().catch(() => undefined); // log va metrika — tayyorla() ichida
  }

  @Cron("0 3 * * *", { name: "hodisa-bolimlari", timeZone: "UTC" })
  async cron(): Promise<void> {
    await this.tayyorla().catch(() => undefined);
  }

  async tayyorla(): Promise<string[]> {
    if (this.b === null) return [];
    try {
      return (await this.b.pool.query<{ nom: string }>("SELECT hodisa_bolimlari_tayyorla(2) AS nom")).rows.map((r) => r.nom);
    } catch (err) {
      fonXatolari.inc({ ish: "hodisa-bolimlari" });
      this.log.error({ err, ish: "hodisa-bolimlari" }, "hodisa bo'limlari yaratilmadi — yangi hodisalar DEFAULT bo'limga tushadi");
      throw err;
    }
  }
}

@Global()
@Module({})
export class StatistikaModule {
  static forRoot(o: StatistikaBogliqliklari | undefined, configdan: boolean): DynamicModule {
    const controllers: Type[] = [];
    const providers: Provider[] = [BolimlarXizmati];
    if (o !== undefined) {
      controllers.push(StatistikaController);
      providers.push({ provide: STATISTIKA, useValue: o });
    } else if (configdan) {
      controllers.push(StatistikaController);
      providers.push({
        provide: STATISTIKA, inject: [SAQLASH],
        useFactory: (s: Saqlash): StatistikaBogliqliklari => {
          if (s.pool === undefined) throw new Error("statistika: ma'lumot pool'i yo'q (SAQLASH=postgres|prisma kerak)");
          return { pool: s.pool };
        },
      });
    } else {
      providers.push({ provide: STATISTIKA, useValue: null });
    }
    return { module: StatistikaModule, controllers, providers, exports: [STATISTIKA] };
  }
}
