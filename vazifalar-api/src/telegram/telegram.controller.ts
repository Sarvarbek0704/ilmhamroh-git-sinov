// telegram.controller.ts — 30 C (29-qism B holat 22 `telegramRouteri` ning Nest shakli): Telegram hisobini ulash (28 sessiyasi bilan).
//   POST   /v1/telegram/ulash → { havola: "https://t.me/<bot>?start=<token>", muddatSoniya } — bot /start <token> da ulaydi (#20)
//   GET    /v1/telegram/ulash → { ulangan, faol }
//   DELETE /v1/telegram/ulash → ulanishni o'chirish (RLS + WHERE foydalanuvchi_id)
// Bot o'zi — alohida jarayon (src/bot.ts, Nest'siz: long polling, DI kerak emas).
import { Controller, Delete, Get, Header, HttpCode, Inject, Post } from "@nestjs/common";
import type { Pool } from "pg";
import { egasiSifatida } from "../umumiy/rls.ts";
import { Egasi } from "../umumiy/egasi.ts";
import { Cheklov } from "../auth/cheklov.guard.ts";
import { API_CHEKLOVI } from "../auth/qoriqchi.ts";
import { TELEGRAM_ULASH } from "../tokenlar.ts";
import { ULASH_MUDDAT_S, ulashTokeni, type TokenRedis } from "./manba.ts";

export type TelegramUlashSozlamasi = { pool: Pool; redis: TokenRedis; botNomi: string };

@Controller("telegram")
@Cheklov(API_CHEKLOVI)
export class TelegramController {
  constructor(@Inject(TELEGRAM_ULASH) private readonly o: TelegramUlashSozlamasi) {}

  @Post("ulash")
  @Header("Cache-Control", "no-store")
  async ulash(@Egasi() egasi: number): Promise<object> {
    const t = await ulashTokeni(this.o.redis, egasi);
    return { havola: `https://t.me/${this.o.botNomi}?start=${t}`, muddatSoniya: ULASH_MUDDAT_S };
  }

  @Get("ulash")
  async holat(@Egasi() egasi: number): Promise<object> {
    const q = await egasiSifatida(this.o.pool, egasi, (c) => c.query<{ faol: boolean }>("SELECT faol FROM telegram_ulanishlar WHERE foydalanuvchi_id = $1", [egasi]));
    return { ulangan: q.rows.length > 0, faol: q.rows[0]?.faol ?? false };
  }

  @Delete("ulash")
  @HttpCode(204)
  async uz(@Egasi() egasi: number): Promise<void> {
    await egasiSifatida(this.o.pool, egasi, (c) => c.query("DELETE FROM telegram_ulanishlar WHERE foydalanuvchi_id = $1", [egasi]));
  }
}
