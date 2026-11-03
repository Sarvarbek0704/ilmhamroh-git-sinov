// teglar.controller.ts — /v1/teglar: teglar va nechta vazifada
import { All, Controller, VERSION_NEUTRAL, Get, Header, Req } from "@nestjs/common";
import type { Request } from "express";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { MetodYoqXatosi } from "../umumiy/xatolar.ts";
import type { TegSoni } from "./ombor.ts";
import { VazifalarService } from "./vazifalar.service.ts";
import { Cheklov } from "../auth/cheklov.guard.ts";
import { API_CHEKLOVI } from "../auth/qoriqchi.ts";

@Controller({ path: "teglar", version: ["1", VERSION_NEUTRAL] })
@Cheklov(API_CHEKLOVI)
export class TeglarController {
  constructor(private readonly xizmat: VazifalarService) {}

  @Get()
  @Header("Cache-Control", "private, no-cache")
  async teglar(): Promise<{ teglar: TegSoni[] }> {
    return { teglar: await this.xizmat.teglar() };
  }

  @ApiExcludeEndpoint() // 405 yordamchisi — OpenAPI hujjatida haqiqiy metodlarni ustidan yozmasin (#44)
  @All()
  metodYoq(@Req() req: Request): never {
    throw new MetodYoqXatosi(req.method, "GET, HEAD");
  }
}
