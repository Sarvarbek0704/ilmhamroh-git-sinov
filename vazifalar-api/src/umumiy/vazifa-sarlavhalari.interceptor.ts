// vazifa-sarlavhalari.interceptor.ts — #23: bitta vazifa javobiga ETag ("versiya") va Last-Modified — handler qaytargan qiymatdan (RxJS tap).
// Interceptor javob yuborilishidan OLDIN ishlaydi: Express res.json() ETag'ni ko'rib If-None-Match mos kelsa 304 beradi (25 dagidek)
import { Injectable } from "@nestjs/common";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import type { Response } from "express";
import { tap } from "rxjs";
import type { Observable } from "rxjs";
import { vazifaSarlavhalari } from "./shartli.ts";
import type { Vazifa } from "../vazifalar/vazifa.ts";

@Injectable()
export class VazifaSarlavhalariInterceptor implements NestInterceptor<Vazifa, Vazifa> {
  intercept(kontekst: ExecutionContext, keyingi: CallHandler<Vazifa>): Observable<Vazifa> {
    const res = kontekst.switchToHttp().getResponse<Response>();
    return keyingi.handle().pipe(tap((v) => { vazifaSarlavhalari(res, v); }));
  }
}
