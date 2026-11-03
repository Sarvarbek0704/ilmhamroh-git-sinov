// webhook.controller.ts — 30 C (29-qism B holat 35 `webhooklarRouteri` ning Nest shakli; SQL o'zgarmadi): foydalanuvchining chiquvchi webhook obunalari.
//   POST   /v1/webhooklar              { url, hodisalar? } → 201 { id, url, hodisalar, sir } — sir FAQAT shu javobda (keyin ko'rsatilmaydi)
//   GET    /v1/webhooklar              → obunalar (sirsiz)
//   DELETE /v1/webhooklar/:id          → 204
//   GET    /v1/webhooklar/:id/yetkazishlar → oxirgi 50 yetkazish
// URL shakli shu yerda (https, port 443, IP literal — ommaviy); DNS bo'yicha tekshiruv — yuborish paytida (ishchi: xavfsizAgent, DNS rebinding).
import { Controller, Delete, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { egasiSifatida } from "../umumiy/rls.ts";
import { tekshir } from "../umumiy/tekshir.ts";
import { KonfliktXatosi, TopilmadiXatosi, ValidatsiyaXatosi } from "../umumiy/xatolar.ts";
import { Egasi } from "../umumiy/egasi.ts";
import { Cheklov } from "../auth/cheklov.guard.ts";
import { API_CHEKLOVI } from "../auth/qoriqchi.ts";
import { WEBHOOKLAR } from "../tokenlar.ts";
import { sirYarat } from "./imzo.ts";
import { SsrfXato, urlTekshir } from "./ssrf.ts";

export const HODISALAR = ["vazifa.yaratildi", "vazifa.yangilandi", "vazifa.bajarildi", "vazifa.ochirildi"] as const;
export const MAKS_OBUNA = 5;
/** httpRuxsat — lokal dev/sinov: http:// va istalgan port (production'da false) */
export type WebhookSozlamasi = { pool: Pool; httpRuxsat: boolean };

const ObunaSxemasi = z.strictObject({
  url: z.string().max(2000),
  hodisalar: z.array(z.enum(HODISALAR)).min(1).max(HODISALAR.length).optional(),
});
const IdP = z.strictObject({ id: z.string().regex(/^[1-9]\d{0,17}$/).transform(Number) });

type Qator = { id: string; url: string; hodisalar: string[]; faol: boolean; ketma_ket_xato: number; yaratilgan_vaqt: Date };
const korinish = (q: Qator) => ({ id: Number(q.id), url: q.url, hodisalar: q.hodisalar, faol: q.faol, ketmaKetXato: q.ketma_ket_xato, yaratilgan: q.yaratilgan_vaqt });

@Controller("webhooklar")
@Cheklov(API_CHEKLOVI)
export class WebhooklarController {
  constructor(@Inject(WEBHOOKLAR) private readonly o: WebhookSozlamasi) {}

  @Post()
  async yarat(@Egasi() egasi: number, @Req() req: Request, @Res() res: Response): Promise<void> {
    const t = tekshir(ObunaSxemasi, req.body, "body");
    try {
      urlTekshir(t.url, this.o.httpRuxsat ? { httpRuxsat: true, portlar: "hammasi" } : {});
    } catch (x) {
      if (x instanceof SsrfXato) throw new ValidatsiyaXatosi([{ joy: "body.url", xabar: x.message }]);
      throw x;
    }
    const sir = sirYarat();
    const q = await egasiSifatida(this.o.pool, egasi, async (c) => {
      const n = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM webhook_obunalari WHERE foydalanuvchi_id = $1", [egasi])).rows[0]?.n ?? 0;
      if (n >= MAKS_OBUNA) throw new KonfliktXatosi(`Ko'pi bilan ${String(MAKS_OBUNA)} ta webhook`, { kod: "webhook-limiti", sarlavha: "Webhook'lar soni chegarada" });
      return (await c.query<Qator>(
        `INSERT INTO webhook_obunalari (foydalanuvchi_id, url, sir, hodisalar) VALUES ($1, $2, $3, coalesce($4::text[], '{vazifa.yaratildi,vazifa.yangilandi,vazifa.bajarildi,vazifa.ochirildi}'))
         RETURNING id, url, hodisalar, faol, ketma_ket_xato, yaratilgan_vaqt`,
        [egasi, t.url, sir, t.hodisalar ?? null])).rows[0];
    });
    if (q === undefined) throw new Error("webhook INSERT natijasiz");
    res.status(201).location(`/v1/webhooklar/${q.id}`).set("Cache-Control", "no-store").json({ ...korinish(q), sir });
  }

  @Get()
  async royxat(@Egasi() egasi: number): Promise<object> {
    const q = await egasiSifatida(this.o.pool, egasi, (c) => c.query<Qator>(
      "SELECT id, url, hodisalar, faol, ketma_ket_xato, yaratilgan_vaqt FROM webhook_obunalari WHERE foydalanuvchi_id = $1 ORDER BY id", [egasi]));
    return { webhooklar: q.rows.map(korinish) };
  }

  @Delete(":id")
  @HttpCode(204)
  async ochir(@Egasi() egasi: number, @Req() req: Request): Promise<void> {
    const { id } = tekshir(IdP, req.params, "params");
    const q = await egasiSifatida(this.o.pool, egasi, (c) => c.query("DELETE FROM webhook_obunalari WHERE id = $1 AND foydalanuvchi_id = $2", [id, egasi]));
    if (q.rowCount === 0) throw new TopilmadiXatosi("Webhook topilmadi", "topilmadi");
  }

  @Get(":id/yetkazishlar")
  async yetkazishlar(@Egasi() egasi: number, @Req() req: Request): Promise<object> {
    const { id } = tekshir(IdP, req.params, "params");
    const q = await egasiSifatida(this.o.pool, egasi, async (c) => {
      const bor = await c.query("SELECT 1 FROM webhook_obunalari WHERE id = $1 AND foydalanuvchi_id = $2", [id, egasi]);
      if (bor.rowCount === 0) throw new TopilmadiXatosi("Webhook topilmadi", "topilmadi");
      return c.query<{ hodisa_id: string; tur: string; holat: string; urinishlar: number; oxirgi_status: number | null; oxirgi_xato: string | null; yaratilgan_vaqt: Date }>(
        `SELECT hodisa_id, tur, holat, urinishlar, oxirgi_status, oxirgi_xato, yaratilgan_vaqt FROM webhook_yetkazishlar
          WHERE obuna_id = $1 ORDER BY id DESC LIMIT 50`, [id]);
    });
    return { yetkazishlar: q.rows.map((y) => ({ hodisaId: y.hodisa_id, tur: y.tur, holat: y.holat, urinishlar: y.urinishlar, status: y.oxirgi_status, xato: y.oxirgi_xato, vaqt: y.yaratilgan_vaqt })) };
  }
}
