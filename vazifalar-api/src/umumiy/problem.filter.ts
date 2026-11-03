// problem.filter.ts — global exception filter: HAMMA xato bir joyda Problem Details'ga aylanadi (25-qism xato-ishlovchi.ts ning Nest shakli).
// @Catch() — argumentsiz: har qanday xato (IlovaXatosi, Nest HttpException, kutilmagan TypeError…). Global — APP_FILTER (DI bilan: LOG tokeni, #24/#26)
import { Catch, HttpException, Inject, NotFoundException } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import { IlovaXatosi } from "./xatolar.ts";
import { problemYasa, problemYubor } from "./problem.ts";
import type { Problem } from "./problem.ts";
import { joriyLog } from "./log.ts";
import type { Log } from "./log.ts";
import { LOG } from "../tokenlar.ts";

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(@Inject(LOG) private readonly log: Log) {}

  /** to'liq xato (stack bilan) — faqat logga; sorovId joriy so'rov logger'idan (AsyncLocalStorage) */
  private logla(xato: unknown): void {
    joriyLog(this.log).error({ err: xato }, "kutilmagan xato");
  }

  catch(xato: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (res.headersSent) {
      // javob yarmida — status o'zgartirib bo'lmaydi: log va ulanishni yopamiz
      this.logla(xato);
      res.end();
      return;
    }
    const umumiy = { instance: req.originalUrl, sorovId: req.sorovId };
    if (xato instanceof IlovaXatosi) {
      res.set(xato.httpSarlavhalar);
      problemYubor(res, problemYasa(xato.holat, { ...umumiy, kod: xato.kod, sarlavha: xato.sarlavha, detail: xato.message, xatolar: xato.xatolar }));
      return;
    }
    // Nest router'i mos marshrut topmasa NotFoundException ("Cannot GET /yoq") tashlaydi — o'zimizning xabar bilan (Express'dagidek)
    if (xato instanceof NotFoundException) {
      problemYubor(res, problemYasa(404, { ...umumiy, detail: `${req.method} ${req.path} — bunday manzil yo'q` }));
      return;
    }
    // Boshqa Nest HttpException'lari (kutubxonalar tashlaydi) — status saqlanadi, 5xx tafsiloti yashiriladi
    if (xato instanceof HttpException && xato.getStatus() < 500) {
      problemYubor(res, problemYasa(xato.getStatus(), { ...umumiy, detail: xato.message }));
      return;
    }
    // 503 — "tayyor emas" (masalan @nestjs/terminus /health/ready, #51): kutilgan holat, status va tekshiruv natijalari saqlanadi (kutilmagan 500 EMAS)
    if (xato instanceof HttpException && xato.getStatus() === 503) {
      joriyLog(this.log).warn({ tekshiruvlar: xato.getResponse() }, "xizmat tayyor emas (503)");
      problemYubor(res, { ...problemYasa(503, { ...umumiy, detail: "Xizmat vaqtincha tayyor emas" }), tekshiruvlar: xato.getResponse() } as Problem);
      return;
    }
    // Kutilmagan (dasturchi xatosi, DB uzilishi…): tafsilot (stack, xabar) mijozga BERILMAYDI — faqat logga
    this.logla(xato);
    problemYubor(res, problemYasa(500, { ...umumiy, detail: "Kutilmagan xato. sorovId bilan murojaat qiling." }));
  }
}
