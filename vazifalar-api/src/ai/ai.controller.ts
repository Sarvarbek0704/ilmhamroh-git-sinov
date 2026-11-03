// ai.controller.ts — 31-qism: AI yo'llari (faqat /v1; AI_PROVAYDER=yoq bo'lsa — ro'yxatdan o'tmaydi → 404).
//   POST /v1/vazifalar/:id/qadamlar — vazifani qadamlarga bo'lish (#15). `Accept: text/event-stream` — oqim (#14): `event: qadam` har qadam tayyor
//   bo'lishi bilan, oxirida `event: tugadi`; xato — `event: xato` (Problem Details). Mijoz uzilsa — LLM so'rovi ham bekor qilinadi (AbortController).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import { z } from "zod";
import { tekshir } from "../umumiy/tekshir.ts";
import { JsonTana } from "../umumiy/json-tana.guard.ts";
import type { Request, Response } from "express";
import { Egasi } from "../umumiy/egasi.ts";
import { IlovaXatosi } from "../umumiy/xatolar.ts";
import { problemYasa } from "../umumiy/problem.ts";
import { Cheklov } from "../auth/cheklov.guard.ts";
import { API_CHEKLOVI } from "../auth/qoriqchi.ts";
import { IdSxemasi } from "../vazifalar/sxema.ts";
import { AI, BAYROQLAR } from "../tokenlar.ts";
import { bayroqKerak } from "../bayroq/bayroqlar.ts";
import type { BayroqlarXizmati } from "../bayroq/bayroqlar.ts";
import { joriyLog } from "../umumiy/log.ts";
import { LlmXatosi } from "./llm.ts";
import type { AiXizmatlari } from "./ai.module.ts";
import { SavolSxemasi } from "./yordamchi.ts";
import { aiHodisa } from "./nazorat.ts";

/** LLM xatosi → HTTP (Problem Details). Provayderning 429'i — BIZNING mijozimiz uchun 503 (u limitga urilmagan), Retry-After saqlanadi */
export function aiXatosi(x: unknown): unknown {
  if (!(x instanceof LlmXatosi)) return x;
  const kut = x.qaytaUrinishMs === undefined ? {} : { "Retry-After": String(Math.max(1, Math.ceil(x.qaytaUrinishMs / 1000))) };
  switch (x.tur) {
    case "limit":
    case "band":
    case "ochiq":
      return new IlovaXatosi(503, "AI xizmati vaqtincha band — birozdan keyin urinib ko'ring", { kod: "ai-band", sarlavha: "AI vaqtincha mavjud emas", httpSarlavhalar: { "Retry-After": "30", ...kut }, cause: x });
    case "timeout":
      return new IlovaXatosi(504, "AI javobi vaqtida kelmadi", { kod: "ai-timeout", sarlavha: "AI javobi kechikdi", cause: x });
    default:
      return new IlovaXatosi(502, "AI yaroqli javob bermadi", { kod: "ai-javob", sarlavha: "AI javobi yaroqsiz", cause: x });
  }
}

/** so'rov uzilsa (mijoz yopdi) — LLM so'rovini bekor qilish uchun signal */
function uzilishSignali(req: Request, res: Response): AbortSignal {
  const a = new AbortController();
  res.on("close", () => { if (!res.writableFinished) a.abort(new DOMException("mijoz uzildi", "AbortError")); });
  req.on("aborted", () => { a.abort(new DOMException("mijoz uzildi", "AbortError")); });
  return a.signal;
}

/**
 * 32 #01 (31 nuqsoni): mijoz uzilishi + UMUMIY deadline (AI_DEADLINE_MS). Bu signal provayderga, retry kutishiga va zaxira modelga boradi —
 * deadline tugasa butun zanjir to'xtaydi. `mijoz` alohida qaytariladi: "mijoz ketdi" (javob yozilmaydi) va "vaqt tugadi" (504) — har xil holat.
 */
function sorovSignali(req: Request, res: Response, deadlineMs: number): { mijoz: AbortSignal; signal: AbortSignal } {
  const mijoz = uzilishSignali(req, res);
  return { mijoz, signal: AbortSignal.any([mijoz, AbortSignal.timeout(deadlineMs)]) };
}

/** deadline tugagan bo'lsa — qaysi qatlam qanday xato bergan bo'lmasin (TimeoutError, AbortError, retry kutishi) — bitta `timeout` (504) */
function deadlinedan(x: unknown, s: { mijoz: AbortSignal; signal: AbortSignal }): unknown {
  if (!s.mijoz.aborted && s.signal.aborted && !(x instanceof LlmXatosi && x.tur === "timeout")) return new LlmXatosi("timeout", "AI so'rovining umumiy muddati (AI_DEADLINE_MS) tugadi");
  return x;
}

@Controller({ path: "vazifalar", version: "1" })
@Cheklov(API_CHEKLOVI)
export class AiVazifaController {
  constructor(@Inject(AI) private readonly ai: AiXizmatlari, @Inject(BAYROQLAR) private readonly bayroqlar: BayroqlarXizmati | null) {}

  @Post(":id/qadamlar")
  @HttpCode(200)
  async qadamlar(@Egasi() egasi: number, @Param({ schema: IdSxemasi }) { id }: { id: number }, @Req() req: Request, @Res() res: Response): Promise<void> {
    await bayroqKerak(this.bayroqlar, "ai-qadamlar", req); // #25: feature flag
    const ss = sorovSignali(req, res, this.ai.deadlineMs);
    const { signal } = ss;
    const log = joriyLog(this.ai.log);
    if (!(req.headers.accept ?? "").includes("text/event-stream")) {
      try {
        const n = await this.ai.qadamlar.qadamla(egasi, id, signal);
        log.info({ ai: { amal: "qadamlar", model: n.model, tokenlar: n.tokenlar, urinishlar: n.urinishlar, kesh: n.kesh } }, "ai javobi");
        res.json(n);
      } catch (x) {
        throw aiXatosi(deadlinedan(x, ss));
      }
      return;
    }
    // oqim: vazifa topilmasa (404) — sarlavhalar yuborilishidan OLDIN oddiy xato javobi
    await this.ai.qadamlar.vazifa(egasi, id);
    res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const yoz = (hodisa: string, malumot: unknown) => res.write(`event: ${hodisa}\ndata: ${JSON.stringify(malumot)}\n\n`);
    try {
      for await (const h of this.ai.qadamlar.oqimla(egasi, id, signal)) {
        if (h.tur === "qadam") yoz("qadam", { indeks: h.indeks, ...h.qadam });
        else {
          log.info({ ai: { amal: "qadamlar-oqim", model: h.natija.model, tokenlar: h.natija.tokenlar } }, "ai javobi");
          yoz("tugadi", h.natija);
        }
      }
    } catch (x) {
      if (ss.mijoz.aborted) { log.info({ ai: { amal: "qadamlar-oqim", uzildi: true } }, "mijoz uzildi — LLM so'rovi bekor qilindi"); return; }
      const e = aiXatosi(deadlinedan(x, ss));
      if (e instanceof IlovaXatosi) yoz("xato", problemYasa(e.holat, { kod: e.kod, sarlavha: e.sarlavha, detail: e.message }));
      else { log.error({ err: e }, "ai oqimi: kutilmagan xato"); yoz("xato", problemYasa(500, { detail: "Kutilmagan xato" })); }
    } finally {
      res.end();
    }
  }
}

const QidiruvSorovi = z.strictObject({
  q: z.string().trim().min(2).max(200),
  rejim: z.enum(["semantik", "gibrid"]).default("gibrid"),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

/** #17: GET /v1/qidiruv?q=…&rejim=semantik|gibrid — ma'no bo'yicha qidiruv (embedding'lar shu so'rovda dangasa yangilanadi) */
@Controller({ path: "qidiruv", version: "1" })
@Cheklov(API_CHEKLOVI)
export class QidiruvController {
  constructor(@Inject(AI) private readonly ai: AiXizmatlari, @Inject(BAYROQLAR) private readonly bayroqlar: BayroqlarXizmati | null) {}

  @Get()
  async qidir(@Egasi() egasi: number, @Query() q: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<object> {
    await bayroqKerak(this.bayroqlar, "ai-yordamchi", req);
    const s = tekshir(QidiruvSorovi, q, "query");
    const ss = sorovSignali(req, res, this.ai.deadlineMs);
    try {
      const topilgan = s.rejim === "semantik"
        ? await this.ai.qidiruv.semantik(egasi, s.q, s.limit, ss.signal)
        : await this.ai.qidiruv.gibrid(egasi, s.q, s.limit, ss.signal);
      await aiHodisa(this.ai.nazorat.pool, egasi, "semantik_qidiruv", null, { rejim: s.rejim, natijalar: topilgan.length });
      return { rejim: s.rejim, vazifalar: topilgan.map((t) => ({ ...t, ball: Math.round(t.ball * 10_000) / 10_000 })) };
    } catch (x) {
      throw aiXatosi(deadlinedan(x, ss));
    }
  }
}


/** #18: POST /v1/yordamchi/savol { savol } — RAG: o'z vazifalaringiz bo'yicha javob + manbalar (vazifa id va matni) */
@Controller({ path: "yordamchi", version: "1" })
@Cheklov(API_CHEKLOVI)
export class YordamchiController {
  constructor(@Inject(AI) private readonly ai: AiXizmatlari, @Inject(BAYROQLAR) private readonly bayroqlar: BayroqlarXizmati | null) {}

  /** #19: bugungi AI sarfi va chegarasi (kvota sozlanmagan bo'lsa — null) */
  @Get("kvota")
  async kvota(@Egasi() egasi: number): Promise<object> {
    return { kvota: (await this.ai.nazorat.kvota?.holat(egasi)) ?? null };
  }

  @Post("savol")
  @HttpCode(200)
  @JsonTana()
  async savol(@Egasi() egasi: number, @Body({ schema: SavolSxemasi }) body: { savol: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<object> {
    await bayroqKerak(this.bayroqlar, "ai-yordamchi", req);
    const ss = sorovSignali(req, res, this.ai.deadlineMs);
    try {
      const n = await this.ai.yordamchi.savol(egasi, body.savol, ss.signal);
      joriyLog(this.ai.log).info({ ai: { amal: "yordamchi", model: n.model, tokenlar: n.tokenlar, manbalar: n.manbalar.length } }, "ai javobi");
      return n;
    } catch (x) {
      throw aiXatosi(deadlinedan(x, ss));
    }
  }
}
