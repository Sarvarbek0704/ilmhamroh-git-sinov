// ichki.controller.ts — #22 B-126: servislararo (servis → servis) yo'l — foydalanuvchi emas, HMAC imzoli so'rov (28-qism servisImzosi, o'zgarmagan:
// vaqt oynasi, nonce takror himoyasi, xom tana baytlari ustida imzo). 29-qism bot shu naqsh bilan. Sir berilmasa — 404 (yo'l yo'qdek)
import { Body, Controller, HttpCode, Inject, Injectable, Post, UseGuards } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request, RequestHandler, Response } from "express";
import { TopilmadiXatosi } from "../umumiy/xatolar.ts";
import { ICHKI_SIR } from "../tokenlar.ts";
import { servisImzosi } from "./api-kalit.ts";
import { Ochiq } from "./qoriqchi.ts";

@Injectable()
export class ServisImzoGuard implements CanActivate {
  readonly #tekshir: RequestHandler | undefined;

  constructor(@Inject(ICHKI_SIR) sir: Buffer | null) {
    // nonce'lar xotirasi — shu guard nusxasida (singleton, bitta jarayon; ko'p nusxada — Redis SET NX, 27 #60)
    this.#tekshir = sir === null ? undefined : servisImzosi(sir);
  }

  canActivate(kontekst: ExecutionContext): boolean {
    const http = kontekst.switchToHttp();
    if (this.#tekshir === undefined) throw new TopilmadiXatosi(`${http.getRequest<Request>().method} ${http.getRequest<Request>().path} — bunday manzil yo'q`);
    // 28 dagi Express middleware'i aynan: xato bo'lsa sinxron tashlaydi (ImzoXatosi, 401)
    void this.#tekshir(http.getRequest<Request>(), http.getResponse<Response>(), () => undefined);
    return true;
  }
}

@ApiExcludeController()
@Controller("ichki")
@Ochiq()
export class IchkiController {
  @Post("tekshiruv")
  @HttpCode(200)
  @UseGuards(ServisImzoGuard)
  tekshiruv(@Body() tana: unknown): object {
    return { qabul: true, tana };
  }
}
