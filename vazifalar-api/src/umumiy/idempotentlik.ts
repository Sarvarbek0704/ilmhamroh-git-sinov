// idempotentlik.ts — Idempotency-Key (IETF draft-ietf-httpapi-idempotency-key-header): tarmoq uzilib mijoz POST'ni
// qayta yuborsa, ikkinchi vazifa yaratilmaydi — birinchi javob qaytariladi
import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { IlovaXatosi } from "./xatolar.ts";

export type SaqlanganJavob = { holat: number; tana: unknown; location?: string };

export type BoshlashNatijasi =
  | { tur: "yangi" }
  | { tur: "jarayonda" }
  | { tur: "tayyor"; izi: string; javob: SaqlanganJavob }
  | { tur: "boshqa-tana" };

/** Ombor interfeysi: 27-qismda Redis (SET NX PX) bilan almashadi */
export interface IdempotentlikOmbori {
  /** Atomik: kalit yo'q bo'lsa — "jarayonda" deb yozadi va "yangi" qaytaradi */
  boshla(kalit: string, izi: string, muddatMs: number): Promise<BoshlashNatijasi>;
  yakunla(kalit: string, javob: SaqlanganJavob): Promise<void>;
  /** 5xx yoki uzilishda — mijoz qayta urina olsin */
  ochir(kalit: string): Promise<void>;
}

type Yozuv = { izi: string; tugash: number; javob?: SaqlanganJavob };

export class XotiraIdempotentlikOmbori implements IdempotentlikOmbori {
  readonly #yozuvlar = new Map<string, Yozuv>();
  readonly #soat: () => number;
  readonly #maks: number;

  constructor(soat: () => number = Date.now, maks = 10_000) {
    this.#soat = soat;
    this.#maks = maks;
  }

  #tozala(): void {
    const hozir = this.#soat();
    // Map qo'shilish tartibida — muddati bir xil bo'lgani uchun eng eskilari boshida
    for (const [k, y] of this.#yozuvlar) {
      if (y.tugash > hozir && this.#yozuvlar.size <= this.#maks) break;
      this.#yozuvlar.delete(k);
    }
  }

  boshla(kalit: string, izi: string, muddatMs: number): Promise<BoshlashNatijasi> {
    this.#tozala();
    const y = this.#yozuvlar.get(kalit);
    if (y === undefined) {
      this.#yozuvlar.set(kalit, { izi, tugash: this.#soat() + muddatMs });
      return Promise.resolve({ tur: "yangi" });
    }
    if (y.izi !== izi) return Promise.resolve({ tur: "boshqa-tana" });
    if (y.javob === undefined) return Promise.resolve({ tur: "jarayonda" });
    return Promise.resolve({ tur: "tayyor", izi: y.izi, javob: y.javob });
  }

  yakunla(kalit: string, javob: SaqlanganJavob): Promise<void> {
    const y = this.#yozuvlar.get(kalit);
    if (y !== undefined) y.javob = javob;
    return Promise.resolve();
  }

  ochir(kalit: string): Promise<void> {
    this.#yozuvlar.delete(kalit);
    return Promise.resolve();
  }
}

/** Kalitlar tartibidan qat'iy nazar bir xil matn: {"b":1,"a":2} va {"a":2,"b":1} — bitta iz */
function kanonik(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(kanonik).join(",")}]`;
  if (typeof x === "object" && x !== null) {
    return `{${Object.keys(x)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${kanonik((x as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  // JSON.stringify(undefined) ish vaqtida undefined qaytaradi (TS turi esa string deydi) — tanasiz so'rov
  return x === undefined ? "null" : JSON.stringify(x);
}

const KALIT = /^[\x21-\x7e]{1,255}$/; // ko'rinadigan ASCII, bo'shliqsiz
const VAQTINCHA = new Set([401, 403, 429]);

export const MUDDAT_MS = 24 * 60 * 60 * 1000;

export function idempotentlik(ombor: IdempotentlikOmbori, muddatMs = MUDDAT_MS): RequestHandler {
  return async (req, res, next) => {
    const kalit = req.get("idempotency-key");
    if (req.method !== "POST" || kalit === undefined) {
      next();
      return;
    }
    if (!KALIT.test(kalit)) throw new IlovaXatosi(400, "Idempotency-Key — 1..255 ko'rinadigan ASCII belgi", { kod: "idempotentlik-kalit", sarlavha: "Idempotency-Key yaroqsiz" });
    // 28 #07 TOPILMA (test yiqitdi): kalit global edi — Dilnoza Azizning Idempotency-Key + tanasini yuborsa, Azizning saqlangan javobi (vazifasi)
    // unga qaytardi (BOLA). Endi kalit foydalanuvchi bo'yicha: "<egasi>:<kalit>"
    // 30 B: egasi noma'lum (anonim — guard keyin 401 beradi) — kalit saqlanmaydi
    if (req.egasi === undefined) {
      next();
      return;
    }
    const ichkiKalit = `${String(req.egasi)}:${kalit}`;
    const izi = createHash("sha256").update(`${req.method} ${req.originalUrl}\n${kanonik(req.body)}`).digest("base64url");
    const holat = await ombor.boshla(ichkiKalit, izi, muddatMs);
    if (holat.tur === "boshqa-tana") {
      throw new IlovaXatosi(422, "Bu Idempotency-Key boshqa so'rov tanasi bilan ishlatilgan", { kod: "idempotentlik-boshqa-tana", sarlavha: "Idempotency-Key qayta ishlatildi" });
    }
    if (holat.tur === "jarayonda") {
      throw new IlovaXatosi(409, "Shu kalitli so'rov hali bajarilmoqda", { kod: "idempotentlik-jarayonda", sarlavha: "So'rov bajarilmoqda", httpSarlavhalar: { "Retry-After": "1" } });
    }
    if (holat.tur === "tayyor") {
      const { javob } = holat;
      res.set("Idempotency-Replayed", "true");
      if (javob.location !== undefined) res.location(javob.location);
      res.status(javob.holat).json(javob.tana);
      return;
    }
    // Yangi: javobni ushlab saqlaymiz (xato javobi ham res.json orqali o'tadi — Problem Details)
    const asl = res.json.bind(res);
    let ushlandi = false;
    res.json = (tana: unknown) => {
      ushlandi = true;
      const location = res.get("Location");
      // 30 B: Nest'da guard'lar (401/403 — kirish/ruxsat, 429 — tezlik, 400 captcha) shu middleware'dan KEYIN ishlaydi: bu javoblar handler
      // natijasi emas — saqlanmaydi (aks holda kalit 24 soat "429" qaytarardi)
      const saqla =
        res.statusCode >= 500 || VAQTINCHA.has(res.statusCode)
          ? ombor.ochir(ichkiKalit)
          : ombor.yakunla(ichkiKalit, location === undefined ? { holat: res.statusCode, tana } : { holat: res.statusCode, tana, location });
      saqla.catch((x: unknown) => {
        req.log.error({ err: x }, "idempotentlik omboriga yozilmadi");
      });
      return asl(tana);
    };
    // Javob umuman yuborilmay ulanish uzilsa — kalit "jarayonda" qolib ketmasin
    // DIQQAT: mijoz uzilsa (timeout) kalitni O'CHIRMAYMIZ — handler davom etib vazifani baribir yaratadi;
    // birinchi variant "close" da o'chirardi va qayta urinish IKKINCHI vazifani yaratdi (t24 topdi).
    // Javob res.json'siz tugasa (sendStatus, end) — saqlab bo'lmaydi, kalit bo'shatiladi
    res.on("finish", () => {
      if (!ushlandi) void ombor.ochir(ichkiKalit);
    });
    next();
  };
}
