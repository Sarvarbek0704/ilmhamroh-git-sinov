// navbat.controller.ts — 30 C (29-qism B holat 45/50 `muddatRouteri` ning Nest shakli): muddat va eslatma.
//   PUT /v1/vazifalar/:id/muddat  { muddat: "2026-11-05T18:00:00+05:00" | null } → 202; eslatmani ishchi (relay → tizim navbati) rejalaydi/bekor qiladi
//   API Vazifa turida muddat yo'q (25–28 shartnomasi) — alohida resurs; ustun 004 dan beri bazada bor (bot ham shu ustunga yozadi).
// Holat 50 (outbox): muddat va "vazifa.muddat" hodisasi BIR tranzaksiyada — API navbatga to'g'ridan yozmaydi (dual write yo'q).
// Bull Board (/v1/admin/navbat) — Express adapteri, ilova.ts da (admin roli tekshiruvi bilan): u o'z Router'ini beradi, Nest controller emas.
import { Controller, HttpCode, Inject, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { egasiSifatida } from "../umumiy/rls.ts";
import { tekshir } from "../umumiy/tekshir.ts";
import { TopilmadiXatosi } from "../umumiy/xatolar.ts";
import { Egasi } from "../umumiy/egasi.ts";
import { JsonTana } from "../umumiy/json-tana.guard.ts";
import { Cheklov } from "../auth/cheklov.guard.ts";
import { API_CHEKLOVI } from "../auth/qoriqchi.ts";
import { NAVBATLAR } from "../tokenlar.ts";
import { jonliManbaOl } from "../realtime/jonli.ts";
import { hodisaYoz } from "./outbox.ts";
import type { Navbatlar } from "./navbat.ts";

export type NavbatSozlamasi = { pool: Pool; navbatlar: Navbatlar };

const MuddatSxemasi = z.strictObject({ muddat: z.iso.datetime({ offset: true }).nullable() });
const IdP = z.strictObject({ id: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number) });

@Controller("vazifalar/:id/muddat")
@Cheklov(API_CHEKLOVI)
export class MuddatController {
  constructor(@Inject(NAVBATLAR) private readonly o: NavbatSozlamasi) {}

  @Put()
  @HttpCode(202)
  @JsonTana()
  async qoy(@Egasi() egasi: number, @Req() req: Request): Promise<object> {
    const { id } = tekshir(IdP, req.params, "params");
    const { muddat } = tekshir(MuddatSxemasi, req.body, "body");
    const yangi = await egasiSifatida(this.o.pool, egasi, async (c) => {
      const q = (await c.query<{ muddat: Date | null }>(
        "UPDATE vazifalar SET muddat = $3 WHERE id = $1 AND egasi_id = $2 AND ochirilgan_vaqt IS NULL RETURNING muddat", [id, egasi, muddat])).rows[0];
      if (q !== undefined) await hodisaYoz(c, "vazifa.muddat", egasi, { id, muddat: q.muddat?.toISOString() ?? null, manba: jonliManbaOl() });
      return q;
    });
    if (yangi === undefined) throw new TopilmadiXatosi(`Vazifa ${String(id)} topilmadi`, "vazifa-topilmadi");
    return { id, muddat: yangi.muddat, eslatma: yangi.muddat === null ? "bekor qilinadi" : "rejalanadi" };
  }
}
