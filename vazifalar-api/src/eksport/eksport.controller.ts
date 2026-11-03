// eksport.controller.ts — POST → 202 Accepted + Location (holat resursi), mijoz so'rab turadi (polling), tayyor bo'lsa — fayl
import { Body, Controller, Get, HttpCode, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { IlovaXatosi } from "../umumiy/xatolar.ts";
import { ToplamYoli } from "../umumiy/dekoratorlar.ts";
import { EksportSxemasi } from "../vazifalar/sxema.ts";
import type { EksportSorovi } from "../vazifalar/sxema.ts";
import { EksportService } from "./eksport.service.ts";
import { Cheklov } from "../auth/cheklov.guard.ts";
import { API_CHEKLOVI } from "../auth/qoriqchi.ts";

@Controller("eksportlar")
@Cheklov(API_CHEKLOVI)
export class EksportController {
  constructor(private readonly eksport: EksportService) {}

  @Post()
  @HttpCode(202)
  boshla(@Body({ schema: EksportSxemasi }) body: EksportSorovi, @ToplamYoli("eksportlar") asos: string, @Res({ passthrough: true }) res: Response): Record<string, unknown> {
    const ish = this.eksport.boshla(body);
    res.location(`${asos}/${ish.id}`).set("Retry-After", "1");
    return this.eksport.korinish(ish, asos);
  }

  @Get(":id")
  holat(@Param("id") id: string, @ToplamYoli("eksportlar") asos: string, @Res({ passthrough: true }) res: Response): Record<string, unknown> {
    const ish = this.eksport.topilsin(id);
    if (ish.holat === "kutilmoqda" || ish.holat === "bajarilmoqda") res.set("Retry-After", "1");
    res.set("Cache-Control", "no-store");
    return this.eksport.korinish(ish, asos);
  }

  @Get(":id/fayl")
  fayl(@Param("id") id: string, @Res({ passthrough: true }) res: Response): string {
    const ish = this.eksport.topilsin(id);
    if (ish.natija === undefined) throw new IlovaXatosi(409, "Eksport hali tayyor emas", { kod: "eksport-tayyor-emas", sarlavha: "Eksport tayyor emas", httpSarlavhalar: { "Retry-After": "1" } });
    const kengaytma = ish.sorov.format;
    res.attachment(`vazifalar-${ish.yaratildi.slice(0, 10)}.${kengaytma}`).type(kengaytma === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8");
    return ish.natija; // satr — Nest res.send() bilan yuboradi, Content-Type o'zgarmaydi
  }
}
