// dekoratorlar.ts — #25: o'z parametr dekoratorlarimiz (createParamDecorator). Handler @Req() ni olib, ichida ajratish o'rniga — tayyor qiymat:
//   @IfMatchShart() shart: Shart | undefined  — If-Match sarlavhasi (yaroqsiz — 412)
//   @ToplamYoli("vazifalar") asos: string      — "/v1/vazifalar" yoki eskirgan "/vazifalar" (Location, Link uchun)
//   @VazifaYozuvi()                            — dekoratorlar to'plami (applyDecorators)
import { applyDecorators, createParamDecorator, UseInterceptors } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { ifMatch } from "./shartli.ts";
import { asosYol } from "./yol.ts";
import { JsonTana } from "./json-tana.guard.ts";
import { VazifaSarlavhalariInterceptor } from "./vazifa-sarlavhalari.interceptor.ts";

export const IfMatchShart = createParamDecorator((_: unknown, kontekst: ExecutionContext) => ifMatch(kontekst.switchToHttp().getRequest<Request>()));

export const ToplamYoli = createParamDecorator((toplam: string, kontekst: ExecutionContext) => asosYol(kontekst.switchToHttp().getRequest<Request>(), toplam));

/** Bitta vazifani yozadigan endpoint (POST, PUT /:id, PATCH): tana JSON (415) + javobga ETag/Last-Modified — applyDecorators bilan bitta dekorator */
export const VazifaYozuvi = () => applyDecorators(JsonTana(), UseInterceptors(VazifaSarlavhalariInterceptor));
