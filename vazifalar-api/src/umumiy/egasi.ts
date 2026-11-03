// egasi.ts — C bosqich: @Egasi() — joriy so'rov egasi (number). 29-qism Express routerlari `req.egasi` ni o'qirdi (egasiniAniqla middleware'i
// qo'ygandan keyin); Nest'da u ixtiyoriy (anonim so'rovda yo'q — global KirishGuard 401 beradi). Dekorator turini aniq qiladi: handler ichida
// `number | undefined` tekshiruvi takrorlanmaydi. Guard o'tkazgan, lekin egasi yo'q holat (dasturchi xatosi — @Ochiq yo'lda @Egasi) — 401.
import { createParamDecorator } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { KirilmaganXatosi } from "../auth/middleware.ts";

export function egasiOl(req: Request): number {
  if (req.egasi === undefined) throw new KirilmaganXatosi();
  return req.egasi;
}

export const Egasi = createParamDecorator((_: unknown, k: ExecutionContext): number => egasiOl(k.switchToHttp().getRequest<Request>()));
