// kesh-ombor.ts — #58 DB-119 (holat 58): VazifaOmbori ustidan Redis keshi (decorator) — ichki ombor (pg/prisma) o'zgarmaydi.
// Naqsh: cache-aside + AVLOD (generation) kaliti. O'qishlar kaliti: vz:<egasi>:a<avlod>:<amal>:<so'rov xeshi>. Har muvaffaqiyatli yozuv
// avlodni INCR qiladi — eski kalitlar o'qilmay qoladi va TTL bilan o'ladi (KEYS/SCAN bilan o'chirish kerak emas — 26/27 t54: KEYS bloklaydi).
// Afzalligi: invalidatsiya bitta atomik INCR, poyga yo'q ("DB COMMIT → DEL" tartibidagi xato oynasi yo'q: avlod yozuvdan KEYIN oshadi, shu
// orada eski avlod bilan keshlangan qiymat yangi avlod kaliti emas). Narxi: har o'qishda +1 Redis so'rovi (avlodni olish).
// Chegaralar (halol): yozuv boshqa yo'ldan (psql, boshqa xizmat) bo'lsa — kesh TTL tugaguncha eskirgan; ko'p instansda hammasi bitta Redis'ni
// ishlatgani uchun mos. Redis ishlamasa — kesh chetlab o'tiladi (ilova ishlashda davom etadi), xato log'ga.
import { createHash } from "node:crypto";
import type { RedisClientType } from "redis";
import type { Vazifa, VazifaOzgarishi, YangiVazifa } from "./vazifa.ts";
import type { AlmashtirishVazifasi, Filtr, RoyxatNatija, RoyxatSorovi, Shart, TegSoni, VazifaOmbori, YozishNatijasi } from "./ombor.ts";

export type KeshSozlamasi = { ttlS: number; log?: { warn: (obj: object, xabar: string) => void } };
type Redis = Pick<RedisClientType, "get" | "set" | "incr">;

/** JSON.stringify(undefined) → undefined (tipda string bo'lsa ham) — "topilmadi" (undefined) ham keshlansin: "null" */
function json(x: unknown): string {
  const s: unknown = JSON.stringify(x);
  return typeof s === "string" ? s : "null";
}

export class KeshliOmbor implements VazifaOmbori {
  readonly #ichki: VazifaOmbori;
  readonly #redis: Redis;
  readonly #egasi: number;
  readonly #s: KeshSozlamasi;
  /** statistika (test va o'lchov uchun) */
  readonly hisob = { hit: 0, miss: 0, xato: 0 };

  constructor(ichki: VazifaOmbori, redis: Redis, egasiId: number, sozlama: KeshSozlamasi) {
    this.#ichki = ichki;
    this.#redis = redis;
    this.#egasi = egasiId;
    this.#s = sozlama;
  }

  async #keshdan<T>(amal: string, args: unknown, hisobla: () => Promise<T>): Promise<T> {
    let kalit: string;
    try {
      const avlod = (await this.#redis.get(`vz:${String(this.#egasi)}:avlod`)) ?? "0";
      kalit = `vz:${String(this.#egasi)}:a${avlod}:${amal}:${createHash("sha1").update(json(args)).digest("base64url")}`;
      const bor = await this.#redis.get(kalit);
      if (bor !== null) {
        this.hisob.hit++;
        return JSON.parse(bor) as T;
      }
    } catch (x) {
      this.hisob.xato++;
      this.#s.log?.warn({ err: x }, "kesh: Redis xatosi — to'g'ridan ombordan");
      return hisobla();
    }
    this.hisob.miss++;
    const qiymat = await hisobla();
    // undefined (ol — topilmadi) ham keshlanadi: negative caching (null ko'rinishida)
    const ttl = this.#s.ttlS + Math.floor(Math.random() * Math.max(1, this.#s.ttlS / 10)); // jitter — hamma kalit bir paytda o'lmasin
    await this.#redis.set(kalit, json(qiymat), { EX: ttl }).catch((x: unknown) => {
      this.hisob.xato++;
      this.#s.log?.warn({ err: x }, "kesh: yozib bo'lmadi");
    });
    return qiymat;
  }

  async #yozdi<T>(natija: T): Promise<T> {
    await this.#redis.incr(`vz:${String(this.#egasi)}:avlod`).catch((x: unknown) => {
      // avlod oshmasa — eski kesh TTL tugaguncha ko'rinadi; ilova to'xtamaydi, lekin log'da ko'rinadi
      this.hisob.xato++;
      this.#s.log?.warn({ err: x }, "kesh: avlodni oshirib bo'lmadi — TTL gacha eskirgan javob mumkin");
    });
    return natija;
  }

  royxat(sorov: RoyxatSorovi): Promise<RoyxatNatija> { return this.#keshdan("royxat", sorov, () => this.#ichki.royxat(sorov)); }
  soni(filtr: Filtr): Promise<number> { return this.#keshdan("soni", filtr, () => this.#ichki.soni(filtr)); }
  async ol(id: number): Promise<Vazifa | undefined> { return (await this.#keshdan("ol", id, () => this.#ichki.ol(id))) ?? undefined; }
  teglar(): Promise<TegSoni[]> { return this.#keshdan("teglar", null, () => this.#ichki.teglar()); }

  async yarat(yangi: YangiVazifa): Promise<Vazifa> { return this.#yozdi(await this.#ichki.yarat(yangi)); }
  async yangila(id: number, o: VazifaOzgarishi, shart?: Shart): Promise<YozishNatijasi<Vazifa>> {
    const n = await this.#ichki.yangila(id, o, shart);
    return n.tur === "ok" ? this.#yozdi(n) : n;
  }
  async ochir(id: number, shart?: Shart): Promise<YozishNatijasi<null>> {
    const n = await this.#ichki.ochir(id, shart);
    return n.tur === "ok" ? this.#yozdi(n) : n;
  }
  async almashtirHammasi(v: readonly AlmashtirishVazifasi[]): Promise<{ vazifalar: Vazifa[]; versiya: number }> {
    return this.#yozdi(await this.#ichki.almashtirHammasi(v));
  }
}
