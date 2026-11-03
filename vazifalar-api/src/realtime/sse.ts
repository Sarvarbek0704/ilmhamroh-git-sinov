// sse.ts — Server-Sent Events hub (B-172, B-175): foydalanuvchi bo'yicha ulanishlar, heartbeat, sekin mijozni uzish (backpressure), nginx buferlashini o'chirish.
// 29-qism B (holat 38): ko'p nusxa — `RedisTarqatuvchi`: hodisa Redis Stream'ga (XADD, MAXLEN ~100 — qayta ulanish tarixi) va Pub/Sub kanaliga;
// har API nusxasi kanalni tinglaydi va O'ZIDAGI ulanishlarga yozadi. Hodisa id — Stream id ("1730000000000-0"), Last-Event-ID bilan XRANGE.
// Format 19-qism frontendiga mos (vazifalar/src/jonli.ts): `event: ozgardi`, `data: {"manba": …}`, `retry: 2000`.
import type { Request, Response } from "express";
import type { RedisKlient } from "../ombor-yarat.ts";

export type Hodisa = { id: string; tur: string; malumot: unknown };

/** Tarix manbai: Last-Event-ID dan keyingi hodisalar (ko'p nusxa — Redis Stream) */
export type Tarix = (fId: number, keyin: string) => Promise<Hodisa[]>;

/** Redis Stream id ("ms-seq") taqqoslash; boshqa shakl (bitta nusxa — ichki id) — har doim yangi deb olinadi */
function idKatta(a: string, b: string): boolean {
  const [am, as] = a.split("-").map(Number);
  const [bm, bs] = b.split("-").map(Number);
  if (am === undefined || as === undefined || bm === undefined || bs === undefined || Number.isNaN(am + as + bm + bs)) return true;
  return am > bm || (am === bm && as > bs);
}

type UlanishHolati = { tayyor: boolean; navbat: Hodisa[]; oxirgi: string };

export class SseHub {
  readonly #ulanishlar = new Map<number, Set<Response>>();
  /**
   * Ulanish holati: tarix (Last-Event-ID) yuborilguncha jonli hodisalar navbatda turadi; oxirgi yuborilgan id — takror va eskisi tashlanadi.
   * Sabab (holat 38 testi): qayta ulanish paytida bir hodisa ham Pub/Sub'dan (kechikib), ham XRANGE'dan keldi — mijoz uni ikki marta oldi.
   */
  readonly #holat = new WeakMap<Response, UlanishHolati>();
  readonly #maksBufer: number;
  readonly #retryMs: number;
  readonly #heartbeat: NodeJS.Timeout;
  readonly #tarix: Tarix | undefined;

  constructor(o: { heartbeatMs?: number; maksBuferBayt?: number; retryMs?: number; tarix?: Tarix } = {}) {
    this.#maksBufer = o.maksBuferBayt ?? 256 * 1024;
    this.#retryMs = o.retryMs ?? 2000;
    this.#tarix = o.tarix;
    // 25 s: proxy/brauzer bo'sh ulanishni uzmasin (nginx proxy_read_timeout sukut 60 s); izoh qatori — mijozda hodisa chiqarmaydi
    this.#heartbeat = setInterval(() => { for (const s of this.#ulanishlar.values()) for (const r of s) this.#yoz(r, ": ping\n\n"); }, o.heartbeatMs ?? 25_000);
    this.#heartbeat.unref();
  }

  get ulanishlarSoni(): number {
    let n = 0;
    for (const s of this.#ulanishlar.values()) n += s.size;
    return n;
  }

  /** Express handler ichida (auth oldin — cookie/sessiya; EventSource sarlavha yubora olmaydi, `withCredentials: true` bilan cookie yuboradi). */
  async ulan(req: Request, res: Response, fId: number): Promise<void> {
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // nginx: shu javobni buferlamasin
    });
    res.flushHeaders();
    res.write(`retry: ${String(this.#retryMs)}\n\n`);
    const oxirgi = req.get("last-event-id") ?? (typeof req.query["lastEventId"] === "string" ? req.query["lastEventId"] : undefined);
    const keyin = oxirgi !== undefined && /^\d{1,20}-\d{1,10}$/.test(oxirgi) && this.#tarix !== undefined ? oxirgi : undefined;
    const h: UlanishHolati = { tayyor: keyin === undefined, navbat: [], oxirgi: keyin ?? "0-0" };
    this.#holat.set(res, h);
    // Avval ro'yxatga (tarix o'qilayotganda kelgan hodisa yo'qolmasin — navbatga tushadi), keyin tarix, keyin navbat — id tartibida, takrorsiz
    const s = this.#ulanishlar.get(fId) ?? new Set<Response>();
    s.add(res);
    this.#ulanishlar.set(fId, s);
    req.on("close", () => {
      s.delete(res);
      if (s.size === 0) this.#ulanishlar.delete(fId);
    });
    if (keyin !== undefined && this.#tarix !== undefined) {
      for (const x of await this.#tarix(fId, keyin)) this.#yuborBittaga(res, x);
      h.tayyor = true;
      for (const x of h.navbat.splice(0)) this.#yuborBittaga(res, x);
    }
  }

  /** Shu nusxadagi foydalanuvchi oynalariga yozadi. Qaytaradi: nechta ulanishga yozildi. */
  yubor(fId: number, h: Hodisa): number {
    let n = 0;
    for (const r of this.#ulanishlar.get(fId) ?? []) {
      const x = this.#holat.get(r);
      if (x !== undefined && !x.tayyor) { x.navbat.push(h); continue; }
      if (this.#yuborBittaga(r, h)) n++;
    }
    return n;
  }

  #yuborBittaga(r: Response, h: Hodisa): boolean {
    const x = this.#holat.get(r);
    if (x !== undefined) {
      if (!idKatta(h.id, x.oxirgi)) return false; // allaqachon yuborilgan (tarix va Pub/Sub ikkalasidan kelgan)
      x.oxirgi = h.id;
    }
    return this.#yoz(r, this.#format(h));
  }

  #format(h: Hodisa): string {
    // `data:` ichida yangi qator bo'lsa — har qator alohida `data:` (protokol); JSON.stringify yangi qatorni \n ga aylantiradi — xavfsiz
    return `id: ${h.id}\nevent: ${h.tur}\ndata: ${JSON.stringify(h.malumot)}\n\n`;
  }

  /** Sekin mijoz: yozuv buferi chegaradan oshsa — uzamiz (u qayta ulanib Last-Event-ID bilan yetishib oladi). */
  #yoz(r: Response, matn: string): boolean {
    if (r.writableEnded || r.destroyed) return false;
    if (r.writableLength > this.#maksBufer) { r.destroy(); return false; }
    r.write(matn);
    return true;
  }

  yop(): void {
    clearInterval(this.#heartbeat);
    for (const s of this.#ulanishlar.values()) for (const r of s) r.end();
    this.#ulanishlar.clear();
  }
}

/** node-redis 6 klientidan kerakli minimum */
export type JonliRedis = Pick<RedisKlient, "xAdd" | "xRange" | "publish" | "expire">;
export type JonliObuna = { subscribe(kanal: string, f: (xabar: string) => void): Promise<void> };

const KANAL = "vz:jonli";
const oqim = (fId: number) => `vz:jonli:${String(fId)}`;

/** Ko'p nusxali tarqatish. `nashr` — hodisa yozilgan nusxada (holat 50 dan — ishchi relay); `tingla` — har API nusxasida bir marta (alohida subscriber ulanish). */
export class RedisTarqatuvchi {
  readonly #r: JonliRedis;
  constructor(r: JonliRedis) {
    this.#r = r;
  }
  async nashr(fId: number, tur: string, malumot: unknown): Promise<string> {
    const id = await this.#r.xAdd(oqim(fId), "*", { tur, malumot: JSON.stringify(malumot) }, { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: 100 } });
    await this.#r.expire(oqim(fId), 24 * 3600); // faol bo'lmagan foydalanuvchi oqimi Redis'da qolib ketmasin
    await this.#r.publish(KANAL, JSON.stringify({ fId, id, tur, malumot }));
    return id;
  }
  tarix(): Tarix {
    return async (fId, keyin) => ((await this.#r.xRange(oqim(fId), `(${keyin}`, "+", { COUNT: 100 })) ?? [])
      .map((x) => ({ id: x.id, tur: x.message["tur"] ?? "ozgardi", malumot: JSON.parse(x.message["malumot"] ?? "null") as unknown }));
  }
  static async tingla(sub: JonliObuna, hub: SseHub): Promise<void> {
    await sub.subscribe(KANAL, (x) => {
      const h = JSON.parse(x) as { fId: number; id: string; tur: string; malumot: unknown };
      hub.yubor(h.fId, { id: h.id, tur: h.tur, malumot: h.malumot });
    });
  }
}
