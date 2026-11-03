// bildirishnoma.controller.ts — 30 C (29-qism B holat 18 `marshrut.ts` + `sms/ulash.ts` callback'ining Nest shakli; SQL o'zgarmadi):
//   GET  /v1/bildirishnomalar?limit=&kursor=   — keyset (yaratilgan_vaqt, id) bo'yicha, yangi → eski; javobda oqilmagan soni
//   POST /v1/bildirishnomalar/oqildi           — { idlar: [..] } yoki { hammasi: true }
//   GET  /v1/push/kalit                        — VAPID ochiq kaliti (frontend PushManager.subscribe uchun)
//   POST /v1/push/obuna, DELETE /v1/push/obuna — brauzer obunasi (endpoint bo'yicha upsert / o'chirish)
//   POST /v1/sms/callback?id=b<id>.<HMAC>       — SMS provayderi (Eskiz) yetkazish holati: sessiyasiz (@Ochiq), imzo id ichida
// Ma'lumot pool'i — vazifalar_api (RLS): har so'rov egasiSifatida tranzaksiyada + WHERE foydalanuvchi_id (ikki qatlam).
import { Controller, Delete, Get, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { egasiSifatida } from "../umumiy/rls.ts";
import { tekshir } from "../umumiy/tekshir.ts";
import { TopilmadiXatosi, ValidatsiyaXatosi } from "../umumiy/xatolar.ts";
import { Egasi } from "../umumiy/egasi.ts";
import { Cheklov } from "../auth/cheklov.guard.ts";
import { API_CHEKLOVI, Ochiq } from "../auth/qoriqchi.ts";
import { BILDIRISHNOMA } from "../tokenlar.ts";
import { smsIdOch } from "../sms/ulash.ts";
import { EskizProvayder } from "../sms/sms.ts";

export type BildirishnomaBogliqliklari = { pool: Pool; vapidOchiq?: string | undefined; smsKaliti?: Buffer | undefined };

const Kursor = z.string().max(100).transform((k, ctx) => {
  const [vaqt, id] = Buffer.from(k, "base64url").toString().split("|");
  const v = new Date(vaqt ?? "");
  if (Number.isNaN(v.getTime()) || !/^\d{1,18}$/.test(id ?? "")) { ctx.addIssue({ code: "custom", message: "kursor yaroqsiz" }); return z.NEVER; }
  return { vaqt: v, id: Number(id) };
});
const RoyxatSorovi = z.strictObject({ limit: z.coerce.number().int().min(1).max(100).default(20), kursor: Kursor.optional() });
const OqildiSxemasi = z.union([
  z.strictObject({ idlar: z.array(z.number().int().positive()).min(1).max(100) }),
  z.strictObject({ hammasi: z.literal(true) }),
]);
// RFC 8291: p256dh — 65 bayt (base64url 87 belgi), auth — 16 bayt (22 belgi). Endpoint — faqat https (push xizmati), uzunligi cheklangan
const PushObunaSxemasi = z.strictObject({
  endpoint: z.url({ protocol: /^https$/ }).max(2000),
  expirationTime: z.number().nullable().optional(),
  keys: z.strictObject({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }),
});

type Qator = { id: string; tur: string; sarlavha: string; matn: string; havola: string | null; oqilgan_vaqt: Date | null; yaratilgan_vaqt: Date };

@Controller("bildirishnomalar")
@Cheklov(API_CHEKLOVI)
export class BildirishnomalarController {
  constructor(@Inject(BILDIRISHNOMA) private readonly b: BildirishnomaBogliqliklari) {}

  @Get()
  async royxat(@Egasi() fId: number, @Req() req: Request): Promise<object> {
    const s = tekshir(RoyxatSorovi, req.query, "query");
    const { qatorlar, oqilmagan } = await egasiSifatida(this.b.pool, fId, async (c) => ({
      qatorlar: (await c.query<Qator>(
        `SELECT id, tur, sarlavha, matn, havola, oqilgan_vaqt, yaratilgan_vaqt FROM bildirishnomalar
          WHERE foydalanuvchi_id = $1 AND ($2::timestamptz IS NULL OR (yaratilgan_vaqt, id) < ($2, $3))
          ORDER BY yaratilgan_vaqt DESC, id DESC LIMIT $4`,
        [fId, s.kursor?.vaqt ?? null, s.kursor?.id ?? null, s.limit + 1])).rows,
      oqilmagan: (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM bildirishnomalar WHERE foydalanuvchi_id = $1 AND oqilgan_vaqt IS NULL", [fId])).rows[0]?.n ?? 0,
    }));
    const sahifa = qatorlar.slice(0, s.limit);
    const oxirgi = sahifa.at(-1);
    return {
      bildirishnomalar: sahifa.map((q) => ({ id: Number(q.id), tur: q.tur, sarlavha: q.sarlavha, matn: q.matn, havola: q.havola, oqilgan: q.oqilgan_vaqt !== null, vaqt: q.yaratilgan_vaqt })),
      oqilmagan,
      keyingiKursor: qatorlar.length > s.limit && oxirgi !== undefined ? Buffer.from(`${oxirgi.yaratilgan_vaqt.toISOString()}|${oxirgi.id}`).toString("base64url") : null,
    };
  }

  @Post("oqildi")
  @HttpCode(200)
  async oqildi(@Egasi() fId: number, @Req() req: Request): Promise<object> {
    const t = tekshir(OqildiSxemasi, req.body, "body");
    const n = await egasiSifatida(this.b.pool, fId, (c) => ("hammasi" in t
      ? c.query("UPDATE bildirishnomalar SET oqilgan_vaqt = now() WHERE foydalanuvchi_id = $1 AND oqilgan_vaqt IS NULL", [fId])
      : c.query("UPDATE bildirishnomalar SET oqilgan_vaqt = now() WHERE foydalanuvchi_id = $1 AND id = ANY($2::bigint[]) AND oqilgan_vaqt IS NULL", [fId, t.idlar])));
    return { belgilandi: n.rowCount ?? 0 };
  }
}

@Controller("push")
@Cheklov(API_CHEKLOVI)
export class PushController {
  constructor(@Inject(BILDIRISHNOMA) private readonly b: BildirishnomaBogliqliklari) {}

  /** VAPID sozlanmagan — 404 (29: router umuman ulanmasdi) */
  #kalit(): string {
    if (this.b.vapidOchiq === undefined) throw new TopilmadiXatosi("Push sozlanmagan", "push-yoq");
    return this.b.vapidOchiq;
  }

  @Get("kalit")
  kalit(): object {
    return { kalit: this.#kalit() };
  }

  @Post("obuna")
  async obuna(@Egasi() fId: number, @Req() req: Request): Promise<object> {
    this.#kalit();
    const o = tekshir(PushObunaSxemasi, req.body, "body");
    // Endpoint UNIQUE (bir brauzer — bir obuna). Shu brauzer boshqa hisobga tegishli bo'lsa — yangilanmaydi (DO UPDATE ... WHERE egasi):
    // INSERT 0 qator → 422 (frontend obunani bekor qilib qayta yaratadi — yangi endpoint). vazifalar_api roli bilan ham xato emas, 0 qator (29 da sinalgan)
    const q = await egasiSifatida(this.b.pool, fId, (c) => c.query(
      `INSERT INTO push_obunalar (foydalanuvchi_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth WHERE push_obunalar.foydalanuvchi_id = $1`,
      [fId, o.endpoint, o.keys.p256dh, o.keys.auth]));
    if (q.rowCount === 0) throw new ValidatsiyaXatosi([{ joy: "body.endpoint", xabar: "bu obuna boshqa hisobga tegishli — brauzerda obunani yangilang" }]);
    return { obuna: true };
  }

  @Delete("obuna")
  @HttpCode(204)
  async ochir(@Egasi() fId: number, @Req() req: Request): Promise<void> {
    this.#kalit();
    const o = tekshir(z.strictObject({ endpoint: z.string().max(2000) }), req.body, "body");
    await egasiSifatida(this.b.pool, fId, (c) => c.query("DELETE FROM push_obunalar WHERE foydalanuvchi_id = $1 AND endpoint = $2", [fId, o.endpoint]));
  }
}

/** Eskiz callback'i — urlencoded yoki JSON (ilova.ts: /v1/sms yo'li uchun urlencoded parser), cookie'siz — CSRF tegmaydi */
@Controller("sms")
@Ochiq()
export class SmsController {
  constructor(@Inject(BILDIRISHNOMA) private readonly b: BildirishnomaBogliqliklari) {}

  @Post("callback")
  @HttpCode(200)
  async callback(@Req() req: Request): Promise<object> {
    const id = this.b.smsKaliti !== undefined && typeof req.query["id"] === "string" ? smsIdOch(this.b.smsKaliti, req.query["id"]) : undefined;
    if (id === undefined) throw new TopilmadiXatosi("Noma'lum SMS", "sms");
    const xom = (req.body as Record<string, unknown> | undefined)?.["status"];
    const status = typeof xom === "string" ? xom.slice(0, 20) : "";
    const holat = EskizProvayder.callbackHolati(status);
    if (holat !== "kutilmoqda") await this.b.pool.query("SELECT sms_yetkazish_holati($1, $2, $3)", [id, holat === "yetkazildi", status]);
    return { qabul: true };
  }
}
