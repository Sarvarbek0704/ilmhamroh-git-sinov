// bayroqlar.ts — 31-qism #25 (B-216): feature flag'lar (sql/306). Baholash ilovada, bayroqlar jadvali jarayon xotirasida 30 s keshlanadi (har so'rovda DB emas).
// Kesh oqibati: admin o'zgartirgani boshqa nusxalarda (instance) 30 s gacha kechikadi — o'zgartirgan nusxada darhol (tozala()). Ko'p nusxada darhol kerak bo'lsa —
// Redis Pub/Sub yoki LISTEN/NOTIFY (darsda). OpenFeature/Unleash/GrowthBook — sinalmagan (tajriba t25: OpenFeature in-memory provayder).
import { Body, Controller, Get, Global, HttpCode, Inject, Module, Param, Put, Req } from "@nestjs/common";
import type { DynamicModule, Provider, Type } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Request } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { AUTH, BAYROQLAR } from "../tokenlar.ts";
import type { AuthBogliqliklari } from "../auth/xizmat.ts";
import { Rollar } from "../auth/qoriqchi.ts";
import { JsonTana } from "../umumiy/json-tana.guard.ts";
import { TopilmadiXatosi } from "../umumiy/xatolar.ts";
import { Audit } from "../audit/audit.ts";

export type Bayroq = { kalit: string; yoqilgan: boolean; foiz: number; rollar: string[]; foydalanuvchilar: number[] };
export type Kim = { id: number; rol?: string | undefined };

/** 0..99 — kalit va foydalanuvchi bo'yicha deterministik (bir bayroqdagi 10 % boshqa bayroqdagi 10 % bilan bir xil odamlar emas — kalit qo'shilgan) */
export function chelak(kalit: string, id: number): number {
  return createHash("sha256").update(`${kalit}:${String(id)}`).digest().readUInt32BE(0) % 100;
}

export function baholash(b: Bayroq | undefined, kim: Kim): boolean {
  if (b === undefined) return true;              // jadvalda yo'q bayroq — xususiyat cheklanmagan (yangi bayroq qo'shilmaguncha eski xulq)
  if (!b.yoqilgan) return false;                 // kill switch — hammaga, ruxsat ro'yxatiga ham
  if (b.foydalanuvchilar.includes(kim.id)) return true;
  if (kim.rol !== undefined && b.rollar.includes(kim.rol)) return true;
  return chelak(b.kalit, kim.id) < b.foiz;
}

export class BayroqlarXizmati {
  #kesh: { vaqt: number; bayroqlar: Map<string, Bayroq> } | undefined;
  constructor(private readonly pool: Pool, private readonly ttlMs = 30_000) {}

  async hammasi(): Promise<Map<string, Bayroq>> {
    if (this.#kesh !== undefined && Date.now() - this.#kesh.vaqt < this.ttlMs) return this.#kesh.bayroqlar;
    const { rows } = await this.pool.query<{ kalit: string; yoqilgan: boolean; foiz: number; rollar: string[]; foydalanuvchilar: string[] }>(
      "SELECT kalit, yoqilgan, foiz, rollar, foydalanuvchilar::text[] AS foydalanuvchilar FROM bayroqlar");
    const bayroqlar = new Map(rows.map((r) => [r.kalit, { ...r, foydalanuvchilar: r.foydalanuvchilar.map(Number) }]));
    this.#kesh = { vaqt: Date.now(), bayroqlar };
    return bayroqlar;
  }

  async yoqilganmi(kalit: string, kim: Kim): Promise<boolean> {
    return baholash((await this.hammasi()).get(kalit), kim);
  }

  tozala(): void {
    this.#kesh = undefined;
  }
}

/** so'rovdan baholash uchun kim (sessiya bo'lsa rol bilan; API kalit — rolsiz: faqat foiz va ruxsat ro'yxati) */
export function kimOl(req: Request): Kim | undefined {
  return req.egasi === undefined ? undefined : { id: req.egasi, rol: req.sessiya?.rol };
}

/** xususiyat yoqilmagan bo'lsa — 404 (xususiyat mavjudligini oshkor qilmaymiz) */
export async function bayroqKerak(b: BayroqlarXizmati | null, kalit: string, req: Request): Promise<void> {
  const kim = kimOl(req);
  if (b === null || kim === undefined) return;
  if (!(await b.yoqilganmi(kalit, kim))) throw new TopilmadiXatosi(`${req.method} ${req.path} — bunday manzil yo'q`, "xususiyat-yoq", "Topilmadi");
}

/** GET /v1/bayroqlar — joriy foydalanuvchi uchun baholangan bayroqlar (frontend UI'ni shunga qarab ko'rsatadi; qoidalar oshkor qilinmaydi) */
@Controller("bayroqlar")
export class BayroqlarController {
  constructor(@Inject(BAYROQLAR) private readonly b: BayroqlarXizmati) {}

  @Get()
  async royxat(@Req() req: Request): Promise<Record<string, boolean>> {
    const kim = kimOl(req);
    const hammasi = await this.b.hammasi();
    return Object.fromEntries([...hammasi.values()].map((x) => [x.kalit, kim === undefined ? false : baholash(x, kim)]));
  }
}

const BayroqSxemasi = z.strictObject({
  yoqilgan: z.boolean(),
  foiz: z.int().min(0).max(100),
  rollar: z.array(z.enum(["foydalanuvchi", "admin"])).max(2).default([]),
  foydalanuvchilar: z.array(z.int().positive()).max(1000).default([]),
  tavsif: z.string().max(200).optional(),
});
const Kalit = z.strictObject({ kalit: z.string().regex(/^[a-z][a-z0-9-]{1,49}$/) });

@Controller("admin/bayroqlar")
@Rollar("admin")
export class AdminBayroqlarController {
  constructor(@Inject(BAYROQLAR) private readonly b: BayroqlarXizmati, @Inject(AUTH) private readonly auth: AuthBogliqliklari) {}

  @Get()
  async royxat(): Promise<Bayroq[]> {
    return [...(await this.b.hammasi()).values()];
  }

  /** yaratish yoki o'zgartirish (upsert) — auditga yoziladi, shu nusxaning keshi darhol tozalanadi */
  @Put(":kalit")
  @HttpCode(200)
  @JsonTana()
  @Audit("bayroq.ozgartirildi", "bayroq")
  async yoz(@Param({ schema: Kalit }) { kalit }: { kalit: string }, @Body({ schema: BayroqSxemasi }) x: z.output<typeof BayroqSxemasi>): Promise<Bayroq> {
    await this.auth.pool.query(
      `INSERT INTO bayroqlar (kalit, yoqilgan, foiz, rollar, foydalanuvchilar, tavsif, yangilangan_vaqt) VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (kalit) DO UPDATE SET yoqilgan = $2, foiz = $3, rollar = $4, foydalanuvchilar = $5, tavsif = coalesce($6, bayroqlar.tavsif), yangilangan_vaqt = now()`,
      [kalit, x.yoqilgan, x.foiz, x.rollar, x.foydalanuvchilar, x.tavsif ?? null]);
    this.b.tozala();
    return { kalit, yoqilgan: x.yoqilgan, foiz: x.foiz, rollar: x.rollar, foydalanuvchilar: x.foydalanuvchilar };
  }
}

@Global()
@Module({})
export class BayroqlarModule {
  /** auth yoqilgan bo'lsa (postgres/prisma) — bayroqlar auth pool'idan o'qiladi; aks holda null (cheklovsiz) */
  static forRoot(yoqilgan: boolean): DynamicModule {
    const controllers: Type[] = yoqilgan ? [BayroqlarController, AdminBayroqlarController] : [];
    const providers: Provider[] = [{
      provide: BAYROQLAR, inject: [AUTH],
      useFactory: (a: AuthBogliqliklari | null): BayroqlarXizmati | null => (yoqilgan && a !== null ? new BayroqlarXizmati(a.pool) : null),
    }];
    return { module: BayroqlarModule, controllers, providers, exports: [BAYROQLAR] };
  }
}
