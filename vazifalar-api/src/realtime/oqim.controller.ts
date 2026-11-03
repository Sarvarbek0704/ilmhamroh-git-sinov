// oqim.controller.ts — 30 C (29-qism B holat 38): GET /v1/oqim — SSE, 28 sessiya cookie'si bilan (EventSource `withCredentials: true`).
// Hodisa `event: ozgardi`, data {manba, tur, vazifaId}, `retry: 2000`, id — Redis Stream id (Last-Event-ID bilan XRANGE; takror hodisa tashlanadi).
// NEGA @Sse() EMAS (A holat 51 dagi /v1/vazifalar/oqim — @Sse + Observable): Nest @Sse javobni o'zi boshqaradi — Last-Event-ID'dan tarixni
// "tarix → navbat → jonli" tartibida, takrorsiz yuborish (29 holat 38 topilmasi), sekin mijozni uzish (backpressure: res.writableLength) va
// SseHub'ning Redis Pub/Sub ko'p nusxa tarqatuvchisi Response obyektini talab qiladi. Solishtiruv — natijalar/tajriba/tC-sse.txt.
import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Egasi } from "../umumiy/egasi.ts";
import { Cheklov } from "../auth/cheklov.guard.ts";
import { API_CHEKLOVI } from "../auth/qoriqchi.ts";
import { JONLI } from "../tokenlar.ts";
import type { SseHub } from "./sse.ts";

@Controller("oqim")
@Cheklov(API_CHEKLOVI) // uzoq ulanish — cheklov bitta so'rov sifatida hisoblanadi
export class OqimController {
  constructor(@Inject(JONLI) private readonly hub: SseHub) {}

  @Get()
  async ulan(@Egasi() egasi: number, @Req() req: Request, @Res() res: Response): Promise<void> {
    await this.hub.ulan(req, res, egasi);
  }
}
