// audit.ts — 31-qism #23 (B-214): audit jurnali Nest'da. `@Audit("amal", "obyekt")` — handler muvaffaqiyatli tugagach (2xx) global AuditInterceptor
// `audit_yoz()` (sql/305: faqat qo'shiladi, hash zanjiri) ga yozadi: aktyor — joriy foydalanuvchi (sessiya yoki API kalit), obyekt_id — `:id` parametri,
// sorov_id — correlation ID (25-qism). Muvaffaqiyatsiz so'rov (4xx/5xx) yozilmaydi — urinishlar `auth_hodisalar` da.
// Yozish amaldan KEYIN, alohida tranzaksiyada: amal bajarilib audit yozilmasa — error log (ogohlantirish). Qat'iy talab bo'lsa — amal bilan bitta tranzaksiyada (darsda).
import { Controller, Get, HttpCode, Inject, Injectable, Post, Query, SetMetadata } from "@nestjs/common";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { from, mergeMap, Observable } from "rxjs";
import { z } from "zod";
import { AUTH, LOG } from "../tokenlar.ts";
import type { AuthBogliqliklari } from "../auth/xizmat.ts";
import { Rollar } from "../auth/qoriqchi.ts";
import { joriyLog } from "../umumiy/log.ts";
import type { Log } from "../umumiy/log.ts";

const AUDIT = "audit:amal";
export type AuditBelgisi = { amal: string; obyekt?: string };
/** @Audit("admin.bloklash", "foydalanuvchi") — muvaffaqiyatli bajarilsa audit jurnaliga */
export const Audit = (amal: string, obyekt?: string): MethodDecorator => SetMetadata(AUDIT, { amal, ...(obyekt === undefined ? {} : { obyekt }) } satisfies AuditBelgisi);

export async function auditYoz(pool: AuthBogliqliklari["pool"], y: { aktyor: number | null; amal: string; obyekt?: string | null; obyektId?: string | null; tafsilot?: Record<string, unknown>; sorovId?: string | null }): Promise<number> {
  const { rows } = await pool.query<{ id: string }>("SELECT audit_yoz($1, $2, $3, $4, $5, $6) AS id",
    [y.aktyor, y.amal, y.obyekt ?? null, y.obyektId ?? null, y.tafsilot ?? {}, y.sorovId ?? null]);
  return Number(rows[0]?.id);
}

/** handler javobidagi `id` (son yoki satr) → satr; boshqa hollarda undefined */
export function javobIdsi(javob: unknown): string | undefined {
  if (typeof javob !== "object" || javob === null || !("id" in javob)) return undefined;
  const id = javob.id;
  return typeof id === "number" || typeof id === "string" ? String(id) : undefined;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, @Inject(AUTH) private readonly auth: AuthBogliqliklari | null, @Inject(LOG) private readonly log: Log) {}

  intercept(k: ExecutionContext, keyingi: CallHandler): Observable<unknown> {
    const b = this.reflector.get<AuditBelgisi | undefined>(AUDIT, k.getHandler());
    if (b === undefined || this.auth === null || k.getType() !== "http") return keyingi.handle();
    const req = k.switchToHttp().getRequest<Request>();
    const pool = this.auth.pool;
    // aktyor so'rov BOSHIDA olinadi: DELETE /v1/auth/men dan keyin sessiya yo'q bo'ladi
    const aktyor = req.egasi ?? null;
    return keyingi.handle().pipe(mergeMap((javob: unknown) => from((async () => {
      try {
        // obyekt identifikatori — yo'l parametri (:id yoki :kalit); 32 #01 (31 nuqsoni): YARATISH yo'llarida parametr yo'q — javobdagi `id` olinadi
        // (avval `api_kalit.yaratildi` da obyekt_id null edi: qaysi kalit yaratilgani jurnaldan topilmasdi). Faqat id — kalit qiymati jurnalga TUSHMAYDI
        const id = req.params["id"] ?? req.params["kalit"] ?? javobIdsi(javob);
        await auditYoz(pool, { aktyor, amal: b.amal, obyekt: b.obyekt ?? null, obyektId: typeof id === "string" ? id : null, sorovId: req.sorovId,
          tafsilot: { metod: req.method, yol: req.originalUrl.split("?")[0] ?? "" } });
      } catch (err) {
        joriyLog(this.log).error({ err, audit: b.amal }, "audit yozilmadi");
      }
      return javob;
    })())));
  }
}

const Royxat = z.strictObject({ keyin: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) });

/** GET /v1/admin/audit — jurnal (keyset), GET /v1/admin/audit/tekshir — hash zanjiri butunligi */
@Controller("admin/audit")
@Rollar("admin")
export class AuditController {
  constructor(@Inject(AUTH) private readonly auth: AuthBogliqliklari) {}

  @Get()
  async royxat(@Query({ schema: Royxat }) q: z.output<typeof Royxat>): Promise<object> {
    const { rows } = await this.auth.pool.query<Record<string, unknown>>(
      `SELECT id::int, vaqt, aktyor_id::int AS "aktyorId", amal, obyekt, obyekt_id AS "obyektId", tafsilot, sorov_id AS "sorovId", encode(hash, 'hex') AS hash
         FROM audit.jurnal WHERE id > $1 ORDER BY id LIMIT $2`, [q.keyin, q.limit]);
    return { yozuvlar: rows, keyingi: rows.length === q.limit ? rows.at(-1)?.["id"] : null };
  }

  @Post("tekshir")
  @HttpCode(200)
  async tekshir(): Promise<object> {
    const { rows } = await this.auth.pool.query<{ id: string; sabab: string }>("SELECT id, sabab FROM audit_tekshir()");
    const { rows: [n] } = await this.auth.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM audit.jurnal");
    return { butun: rows.length === 0, yozuvlar: n?.n ?? 0, buzilganlar: rows.map((r) => ({ id: Number(r.id), sabab: r.sabab })) };
  }
}
