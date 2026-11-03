// admin.controller.ts — #20 B-124 / #39–#40 NS-39: RBAC — administrator yo'llari (28-qism admin.ts ning Nest shakli). @Rollar("admin") — klass darajasida:
// rol sessiyadan (bazadan, har so'rovda — rol o'zgarsa darhol kuchga kiradi). 401 — kirilmagan, 403 — ruxsat yo'q. Admin boshqa foydalanuvchining
// VAZIFALARINI ko'rmaydi (maxfiylik) — faqat hisoblarni boshqaradi. Har amal jurnalga (kim, kimni).
import { Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { IlovaXatosi, TopilmadiXatosi } from "../umumiy/xatolar.ts";
import { TURLAR } from "../vazifalar/pg-ombor.ts";
import { AuthService, mijoz } from "./auth.service.ts";
import { Rollar } from "./qoriqchi.ts";
import { Audit } from "../audit/audit.ts";

const Id = z.strictObject({ id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const Royxat = z.strictObject({ limit: z.coerce.number().int().min(1).max(100).default(20), keyin: z.coerce.number().int().nonnegative().default(0) });

@ApiTags("Admin")
@Controller("admin")
@Rollar("admin")
export class AdminController {
  constructor(private readonly auth: AuthService) {}

  /** Hisoblar ro'yxati (keyset: id > keyin) — parol hash, telefon, sirlar QAYTARILMAYDI (BOPLA, #31) */
  @Get("foydalanuvchilar")
  async royxat(@Query({ schema: Royxat }) query: z.output<typeof Royxat>): Promise<object> {
    const { rows } = await this.auth.d.pool.query<Record<string, unknown>>({
      text: `SELECT id, email, toliq_ism AS "toliqIsm", rol, yaratilgan_vaqt AS yaratilgan, email_tasdiqlangan_vaqt IS NOT NULL AS "emailTasdiqlangan",
                    bloklangan_vaqt IS NOT NULL AS bloklangan
             FROM foydalanuvchilar WHERE id > $1 ORDER BY id LIMIT $2`, values: [query.keyin, query.limit + 1], types: TURLAR });
    const keyingi = rows.length > query.limit ? (rows[query.limit - 1]?.["id"] as number) : null;
    return { foydalanuvchilar: rows.slice(0, query.limit), keyingi };
  }

  /** Bloklash: kirish taqiqlanadi va BARCHA sessiyalari darhol bekor */
  @Post("foydalanuvchilar/:id/bloklash")
  @Audit("admin.bloklash", "foydalanuvchi")
  @HttpCode(204)
  async bloklash(@Param({ schema: Id }) { id }: { id: number }, @Req() req: Request): Promise<void> {
    const admin = req.sessiya;
    if (admin === undefined) throw new IlovaXatosi(500, "sessiya yo'q (guard)");
    if (id === admin.foydalanuvchi.id) throw new IlovaXatosi(409, "O'zingizni bloklay olmaysiz", { kod: "ozini-bloklash", sarlavha: "Mumkin emas" });
    const { rowCount } = await this.auth.d.pool.query("UPDATE foydalanuvchilar SET bloklangan_vaqt = coalesce(bloklangan_vaqt, now()) WHERE id = $1 AND rol <> 'admin'", [id]);
    if (rowCount !== 1) throw new TopilmadiXatosi("Foydalanuvchi topilmadi (yoki administrator)", "foydalanuvchi-topilmadi", "Topilmadi");
    const bekor = await this.auth.d.sessiyalar.hammasiniBekorQil(id);
    await this.auth.d.ombor.hodisa({ tur: "admin_bloklash", foydalanuvchiId: id, ...mijoz(req), tafsilot: { admin: admin.foydalanuvchi.id, bekorSessiyalar: bekor } });
  }

  @Post("foydalanuvchilar/:id/blokdan-chiqarish")
  @Audit("admin.blokdan_chiqarish", "foydalanuvchi")
  @HttpCode(204)
  async blokdanChiqarish(@Param({ schema: Id }) { id }: { id: number }, @Req() req: Request): Promise<void> {
    const { rowCount } = await this.auth.d.pool.query("UPDATE foydalanuvchilar SET bloklangan_vaqt = NULL WHERE id = $1", [id]);
    if (rowCount !== 1) throw new TopilmadiXatosi("Foydalanuvchi topilmadi", "foydalanuvchi-topilmadi", "Topilmadi");
    await this.auth.d.ombor.hodisa({ tur: "admin_blokdan_chiqarish", foydalanuvchiId: id, ...mijoz(req), tafsilot: { admin: req.sessiya?.foydalanuvchi.id } });
  }
}
