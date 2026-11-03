// jonli.ts — 29-qism B (holat 38): vazifalar-api ga SSE ulash (#38, #41).
//   GET /v1/oqim — sessiya cookie'si bilan (EventSource withCredentials); hodisa: `event: ozgardi`, data {manba, tur, vazifaId}
//   X-Jonli-Manba — o'zgarishni yuborgan oyna identifikatori (19-qism jonli-manba.ts): o'sha oyna o'z hodisasini e'tiborsiz qoldiradi.
//   Sarlavha so'rov kontekstida (AsyncLocalStorage) saqlanadi — xabarchi uni HTTP'ni bilmasdan oladi.
import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
import type { Log } from "../umumiy/log.ts";
import type { Xabarchi } from "../umumiy/webhook.ts";
import type { RedisTarqatuvchi, SseHub } from "./sse.ts";

const MANBA = new AsyncLocalStorage<string | undefined>();

/** Joriy so'rovning X-Jonli-Manba qiymati (29-qism B, holat 50: outbox hodisasiga yoziladi) */
export const jonliManbaOl = (): string | null => MANBA.getStore() ?? null;

/** X-Jonli-Manba (64 belgigacha, [A-Za-z0-9_-]) → so'rov konteksti */
export const jonliManba: RequestHandler = (req, _res, next) => {
  const m = req.get("x-jonli-manba");
  MANBA.run(m !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(m) ? m : undefined, next);
};

/** Vazifa hodisasi → SSE. Ko'p nusxa: Redis orqali (tarqatuvchi), bitta nusxa (Redis yo'q) — to'g'ridan hub'ga */
export function jonliXabarchi(o: { hub: SseHub; tarqatuvchi?: RedisTarqatuvchi | undefined; log: () => Pick<Log, "warn"> }): (egasi: number) => Xabarchi {
  let ichkiId = 0;
  return (egasi) => (hodisa, v) => {
    const malumot = { manba: MANBA.getStore() ?? null, tur: hodisa, vazifaId: v.id };
    if (o.tarqatuvchi === undefined) {
      o.hub.yubor(egasi, { id: `${String(Date.now())}-${String(ichkiId++)}`, tur: "ozgardi", malumot });
      return;
    }
    const l = o.log();
    o.tarqatuvchi.nashr(egasi, "ozgardi", malumot).catch((err: unknown) => { l.warn({ err, hodisa }, "jonli hodisa nashr qilinmadi"); });
  };
}
