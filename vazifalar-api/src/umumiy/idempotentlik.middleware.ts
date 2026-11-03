// idempotentlik.middleware.ts — #21: 25-qism Express middleware'i (idempotentlik.ts) Nest klass middleware'iga o'raladi: ombor DI'dan
// (IDEMPOTENTLIK_OMBORI tokeni — testda soxta soatli ombor, 27/29 da Redis), ulanish — VazifalarModule.configure() (MiddlewareConsumer)
import { Inject, Injectable } from "@nestjs/common";
import type { NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { idempotentlik } from "./idempotentlik.ts";
import type { IdempotentlikOmbori } from "./idempotentlik.ts";
import { IDEMPOTENTLIK_OMBORI } from "../tokenlar.ts";

/**
 * Nest 12.2 TOPILMASI (holat 26): forRoutes(VazifalarController) har marshrut uchun alohida ro'yxatdan o'tkazadi; Express use() prefiks bo'yicha
 * moslaydi — POST /v1/vazifalar uchun middleware IKKI marta ishladi ("" POST va @All "" marshrutlari) va ikkinchi chaqiruv birinchisining
 * "jarayonda" yozuvini ko'rib 409 qaytardi. Nest bitta forRoutes ichidagi takrorni o'zi o'tkazib yuboradi, marshrutlar orasidagisini — yo'q.
 * Shuning uchun: bir so'rovga bir marta
 */
const ishlangan = new WeakSet<Request>();

@Injectable()
export class IdempotentlikMiddleware implements NestMiddleware {
  readonly #ishlovchi: RequestHandler;

  constructor(@Inject(IDEMPOTENTLIK_OMBORI) ombor: IdempotentlikOmbori) {
    this.#ishlovchi = idempotentlik(ombor);
  }

  // Promise qaytariladi — Express 5 rad etilgan Promise'ni next(err) ga yuboradi (409/422/400 → Problem Details filtri)
  use(req: Request, res: Response, next: NextFunction): unknown {
    if (ishlangan.has(req)) {
      next();
      return undefined;
    }
    ishlangan.add(req);
    return this.#ishlovchi(req, res, next);
  }
}
