// json-tana.guard.ts — #22: tanali so'rov faqat JSON bo'lsin (415). Express'da route middleware edi (jsonKerak); Nest'da route darajasidagi
// middleware yo'q, pipe esa guard'dan KEYIN ishlaydi (t07) — 415 validatsiyadan (422) OLDIN chiqishi uchun guard + metama'lumot dekoratori.
// @JsonTana() belgisiz marshrut (GET, DELETE, @All 405) tekshirilmaydi
import { Injectable, SetMetadata } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { jsonTanaKerak } from "./json-kerak.ts";

const JSON_TANA = "vazifalar:json-tana";
/** Handler'ga: "tana JSON bo'lishi shart". Nega Reflector.createDecorator emas: uning get() turi T deydi (undefined'siz), belgisiz
 * handler'da esa ish vaqtida undefined — lint "shart doim true" deb xato beradi (holat 20 topilmasi). SetMetadata + get<T | undefined> — aniq */
export const JsonTana = (): MethodDecorator => SetMetadata(JSON_TANA, true);

@Injectable()
export class JsonTanaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(kontekst: ExecutionContext): boolean {
    if (this.reflector.get<boolean | undefined>(JSON_TANA, kontekst.getHandler()) === true) jsonTanaKerak(kontekst.switchToHttp().getRequest<Request>());
    // false qaytarsak Nest 403 beradi — bizga 415 kerak: shuning uchun jsonTanaKerak o'zi IlovaXatosi(415) tashlaydi
    return true;
  }
}
