// ai.module.ts — 31-qism AI moduli. Testlar tayyor bog'liqlik beradi (soxta provayder); config rejimida — AI_PROVAYDER != "yoq" va postgres/prisma bo'lsa.
// Provayder — config'dan (provayderYarat, #16); controller ro'yxati sinxron (Nest metama'lumoti statik) — 30 C IntegratsiyaModule naqshi.
import { Global, Module } from "@nestjs/common";
import type { DynamicModule, Provider, Type } from "@nestjs/common";
import type { Pool } from "pg";
import type { Config } from "../config.ts";
import type { Log } from "../umumiy/log.ts";
import { AI, CONFIG, LOG } from "../tokenlar.ts";
import { SAQLASH } from "../ombor.module.ts";
import type { Saqlash } from "../ombor-yarat.ts";
import type { LlmProvayder } from "./llm.ts";
import { embeddingYorligi, GeminiProvayder } from "./gemini.ts";
import { OpenAiMosProvayder } from "./openai.ts";
import { AnthropicProvayder } from "./anthropic.ts";
import { QadamlarXizmati } from "./qadamlar.ts";
import { AiVazifaController, QidiruvController, YordamchiController } from "./ai.controller.ts";
import { Qidiruv } from "./qidiruv.ts";
import { Yordamchi } from "./yordamchi.ts";
import { ZaxiraliProvayder } from "./zaxira.ts";
import { ChidamliProvayder } from "./chidamli.ts";
import { AiKvota } from "./kvota.ts";
import type { KvotaSozlamasi } from "./kvota.ts";
import { RedisKesh, XotiraKesh } from "./nazorat.ts";
import type { AiKesh, AiNazorat } from "./nazorat.ts";

/** testlar beradigan bog'liqliklar */
export type AiBogliqliklari = {
  pool: Pool; provayder: LlmProvayder; tz?: string;
  /** #17: embedding'lar jadvalidagi model nomi (o'zgarsa — qayta hisoblanadi) */ embeddingModel?: string;
  /** #19: kunlik kvota (berilmasa — cheklovsiz) va javob keshi (berilmasa — jarayon xotirasi) */ kvota?: Omit<KvotaSozlamasi, "tz">; kesh?: AiKesh;
  /** 32 #01: bitta AI so'rovining UMUMIY muddati (retry, backoff, zaxira — hammasi ichida), ms; sukut AI_DEADLINE_SUKUT */ deadlineMs?: number;
};
/** controller'lar oladigan tayyor xizmatlar */
export type AiXizmatlari = { provayder: LlmProvayder; qadamlar: QadamlarXizmati; qidiruv: Qidiruv; yordamchi: Yordamchi; nazorat: AiNazorat; log: Log; deadlineMs: number };

/**
 * 32 #01 (31 nuqsoni): umumiy deadline. 31 kanonida bitta so'rov eng yomon holatda 3 × 20 s timeout + backoff = 60.9 s, zaxira bilan 121.8 s kutardi
 * (31/#29 hisobi). 25 s: (1) jonli o'lchovda javob 1–2 s (31/#15: 0.9–1.8 s) — 12× zaxira; (2) bitta to'liq AI_TIMEOUT_MS (20 s) + tez zaxira sig'adi;
 * (3) ko'p balanser/proksi sukuti 60 s (nginx proxy_read_timeout) va brauzer foydalanuvchisi ~30 s dan oldin uzadi — undan ancha kam.
 * O'zgartirish — AI_DEADLINE_MS (config). Bu ham taxmin: prodakshnda p99 o'lchovi bilan qayta tanlanadi.
 */
export const AI_DEADLINE_SUKUT = 25_000;

/** sukut faqat sinalgan provayder uchun (2026-11-02, t13); openai/anthropic — AI_MODEL majburiy (config), taxminiy nom yozilmaydi */
const GEMINI_SUKUT = "gemini-3.5-flash-lite";

/** #16: config → provayder. gemini — sinalgan; openai/anthropic — SINALMAGAN (kalit yo'q), shartnoma bir xil */
export function provayderYarat(c: Config): LlmProvayder | null {
  const asosiy = asosiyProvayder(c);
  if (asosiy === null) return null;
  // #29: retry (vaqtinchalik xato, jitter, Retry-After) + circuit breaker + bulkhead — provayder atrofida; #16: zaxira model — eng tashqarida
  const p = new ChidamliProvayder(asosiy, { qaytaUrinish: c.AI_QAYTA_URINISH });
  return c.AI_ZAXIRA_MODEL === undefined ? p : new ZaxiraliProvayder(p, c.AI_ZAXIRA_MODEL);
}

function asosiyProvayder(c: Config): LlmProvayder | null {
  switch (c.AI_PROVAYDER) {
    case "yoq":
      return null;
    case "gemini":
      return new GeminiProvayder({ kalit: c.GEMINI_API_KEY ?? "", model: c.AI_MODEL ?? GEMINI_SUKUT, embeddingModel: c.AI_EMBEDDING_MODEL, timeoutMs: c.AI_TIMEOUT_MS });
    case "openai":
      return new OpenAiMosProvayder({ kalit: c.OPENAI_API_KEY ?? "", model: c.AI_MODEL ?? "", embeddingModel: c.AI_EMBEDDING_MODEL, timeoutMs: c.AI_TIMEOUT_MS, ...(c.AI_BASE_URL === undefined ? {} : { api: c.AI_BASE_URL }) });
    case "anthropic":
      return new AnthropicProvayder({ kalit: c.ANTHROPIC_API_KEY ?? "", model: c.AI_MODEL ?? "", timeoutMs: c.AI_TIMEOUT_MS });
  }
}

export function aiYoqilganmi(c: Config, authYoqilgan: boolean): boolean {
  return c.AI_PROVAYDER !== "yoq" && authYoqilgan && (c.SAQLASH === "postgres" || c.SAQLASH === "prisma");
}

function xizmatlar(b: AiBogliqliklari, log: Log): AiXizmatlari {
  const tz = b.tz ?? "Asia/Tashkent";
  const nazorat: AiNazorat = { pool: b.pool, kesh: b.kesh ?? new XotiraKesh(), kvota: b.kvota === undefined ? undefined : new AiKvota(b.pool, { ...b.kvota, tz }) };
  const qidiruv = new Qidiruv({ pool: b.pool, provayder: b.provayder, model: b.embeddingModel ?? `${b.provayder.nom}-embedding`, tz });
  return {
    provayder: b.provayder, log, qidiruv, nazorat, deadlineMs: b.deadlineMs ?? AI_DEADLINE_SUKUT,
    yordamchi: new Yordamchi(b.provayder, qidiruv, tz, nazorat),
    qadamlar: new QadamlarXizmati({ pool: b.pool, provayder: b.provayder, tz, nazorat }),
  };
}

@Global()
@Module({})
export class AiModule {
  static forRoot(o: AiBogliqliklari | undefined, configdan: boolean): DynamicModule {
    const controllers: Type[] = [];
    const providers: Provider[] = [];
    if (o !== undefined || configdan) controllers.push(AiVazifaController, QidiruvController, YordamchiController);
    if (o !== undefined) providers.push({ provide: AI, inject: [LOG], useFactory: (log: Log) => xizmatlar(o, log) });
    else if (configdan) {
      providers.push({
        provide: AI, inject: [CONFIG, SAQLASH, LOG],
        useFactory: (c: Config, s: Saqlash, log: Log): AiXizmatlari => {
          const provayder = provayderYarat(c);
          if (provayder === null || s.pool === undefined) throw new Error("AI: provayder yoki ma'lumot pool'i yo'q");
          log.info({ ai: { provayder: provayder.nom, model: provayder.model } }, "AI yoqildi");
          return xizmatlar({ pool: s.pool, provayder, tz: c.APP_TZ, embeddingModel: embeddingYorligi(c.AI_EMBEDDING_MODEL), deadlineMs: c.AI_DEADLINE_MS,
            kvota: { kunlikSorov: c.AI_KUNLIK_SOROV, kunlikToken: c.AI_KUNLIK_TOKEN }, ...(s.redis === undefined ? {} : { kesh: new RedisKesh(s.redis) }) }, log);
        },
      });
    } else providers.push({ provide: AI, useValue: null });
    return { module: AiModule, controllers, providers, exports: [AI] };
  }
}
