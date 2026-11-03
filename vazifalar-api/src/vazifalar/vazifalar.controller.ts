// vazifalar.controller.ts — /v1/vazifalar: HTTP ↔ xizmat (25-qism marshrut.ts dan).
// Kirish: Nest 12 `@Body/@Query/@Param({ schema })` — 25-qism Zod sxemalari (sxema.ts), tekshiruv — global SxemaPipe (#18/#19);
// tana JSON — @JsonTana() + global guard (415, #22); ETag/Last-Modified — interceptor (#23); ikkalasi birga — @VazifaYozuvi() (#25); Cache-Control — @Header (#04);
// If-Match va to'plam yo'li — o'z parametr dekoratorlarimiz (#25). @Res({ passthrough: true }) faqat Link, Location va 207 uchun
import { All, Body, Controller, VERSION_NEUTRAL, Delete, Get, Header, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res, Sse, UseInterceptors } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { interval, map, merge, Observable } from "rxjs";
import type { Request, Response } from "express";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { MetodYoqXatosi } from "../umumiy/xatolar.ts";
import type { MaydonXatosi } from "../umumiy/xatolar.ts";
import { JsonTana } from "../umumiy/json-tana.guard.ts";
import { IfMatchShart, ToplamYoli, VazifaYozuvi } from "../umumiy/dekoratorlar.ts";
import { VazifaSarlavhalariInterceptor } from "../umumiy/vazifa-sarlavhalari.interceptor.ts";
import { kursorYoz } from "../umumiy/kursor.ts";
import { ILOVA_SOZLAMALARI, KURSOR_KALITI } from "../tokenlar.ts";
import { Cheklov } from "../auth/cheklov.guard.ts";
import { API_CHEKLOVI } from "../auth/qoriqchi.ts";
import type { IlovaSozlamalari } from "../tokenlar.ts";
import { BulkSxemasi, IdSxemasi, OzgarishSxemasi, RoyxatQuerySxemasi, ToliqVazifaSxemasi, ToplamSxemasi, YangiVazifaSxemasi } from "./sxema.ts";
import type { RoyxatQuery } from "./sxema.ts";
import type { ToliqVazifa, Vazifa, VazifaOzgarishi, YangiVazifa } from "./vazifa.ts";
import type { AlmashtirishVazifasi, Shart } from "./ombor.ts";
import { proyeksiya, royxatSorovi } from "./sorov.ts";
import { VazifalarService } from "./vazifalar.service.ts";

/** API javoblari: brauzer saqlashi mumkin, lekin har safar tekshirsin (private — umumiy keshlar saqlamasin) */
const KESH = ["Cache-Control", "private, no-cache"] as const;

type Natija = { indeks: number; holat: number; vazifa?: Vazifa; xato?: MaydonXatosi };
type Id = { id: number };

// Versiya — ilova.ts dagi enableVersioning (URI): /v1/vazifalar va eskirgan /vazifalar
// 30 B (28 #07 topilmasi — yashirin yo'llar, API9): versiyasiz eski yo'l FAQAT vazifalar va teglar uchun; auth, admin, eksport — faqat /v1
@Controller({ path: "vazifalar", version: ["1", VERSION_NEUTRAL] })
@Cheklov(API_CHEKLOVI)
export class VazifalarController {
  constructor(
    private readonly xizmat: VazifalarService,
    @Inject(ILOVA_SOZLAMALARI) private readonly sozlamalar: IlovaSozlamalari,
    private readonly hodisalar: EventEmitter2,
    @Inject(KURSOR_KALITI) private readonly kursorKaliti: Buffer,
  ) {}

  @Get()
  @Header(...KESH)
  async royxat(@Query({ schema: RoyxatQuerySxemasi }) query: RoyxatQuery, @ToplamYoli("vazifalar") asos: string, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<object> {
    const { sorov, maydonlar, imzo } = royxatSorovi(query, this.sozlamalar.tz, this.kursorKaliti);
    const natija = await this.xizmat.royxat(sorov);
    const sahifa: Record<string, unknown> = { limit: sorov.limit };
    // Keyingi sahifa havolasi: joriy query'ning nusxasi, offset/cursor almashtirilgan
    const havola = (ozgartir: Record<string, string>): string => {
      const p = new URLSearchParams(req.originalUrl.split("?")[1] ?? "");
      p.delete("offset");
      p.delete("cursor");
      for (const [k, v] of Object.entries(ozgartir)) p.set(k, v);
      return `${asos}?${p.toString()}`;
    };
    let keyingi: string | undefined;
    if (sorov.sahifa.tur === "offset") {
      sahifa.offset = sorov.sahifa.offset;
      if (natija.borKeyingi) keyingi = havola({ offset: String(sorov.sahifa.offset + sorov.limit) });
    } else {
      const kursor = natija.keyingi && kursorYoz(natija.keyingi, imzo, this.kursorKaliti);
      sahifa.keyingi = kursor ?? null;
      if (kursor !== undefined) keyingi = havola({ cursor: kursor });
    }
    if (natija.jami !== undefined) sahifa.jami = natija.jami;
    // Link sarlavhasi (RFC 8288) — mijoz URL'ni o'zi yig'ishi shart emas
    if (keyingi !== undefined) res.links({ next: keyingi });
    // ro'yxat ETag'i — Express'niki (tana xeshi, W/"…"): Nest javobni res.json() bilan yuboradi → If-None-Match mos kelsa 304
    return { versiya: natija.versiya, vazifalar: natija.vazifalar.map((v) => proyeksiya(v, maydonlar)), sahifa };
  }

  @Post()
  @VazifaYozuvi()
  async yarat(@Body({ schema: YangiVazifaSxemasi }) body: YangiVazifa, @ToplamYoli("vazifalar") asos: string, @Res({ passthrough: true }) res: Response): Promise<Vazifa> {
    const v = await this.xizmat.yarat(body);
    res.location(`${asos}/${String(v.id)}`);
    return v; // POST — sukut 201
  }

  /** PUT to'plamga — butun ro'yxatni almashtirish (frontend importi/sinxroni); atomik */
  @Put()
  @JsonTana()
  @Header(...KESH)
  async almashtirHammasi(@Body({ schema: ToplamSxemasi }) body: { vazifalar: AlmashtirishVazifasi[] }): Promise<object> {
    const { vazifalar, versiya } = await this.xizmat.almashtirHammasi(body.vazifalar);
    return { versiya, vazifalar };
  }

  // Express metod mos kelmasa 404 beradi — 405 + Allow ni o'zimiz qo'yamiz (Allow ro'yxati test/marshrutlar.test.ts da Discovery bilan tekshiriladi)
  @ApiExcludeEndpoint() // 405 yordamchisi — OpenAPI hujjatida haqiqiy metodlarni ustidan yozmasin (#44)
  @All()
  toplamMetodYoq(@Req() req: Request): never {
    throw new MetodYoqXatosi(req.method, "GET, HEAD, POST, PUT");
  }

  /** Bulk yaratish — qisman muvaffaqiyat: 207 Multi-Status (/:id dan OLDIN — aks holda "toplam" id deb olinadi) */
  @Post("toplam")
  @JsonTana()
  async toplam(@Body({ schema: BulkSxemasi }) body: { vazifalar: unknown[] }, @Res({ passthrough: true }) res: Response): Promise<{ natijalar: Natija[] }> {
    // elementlar alohida tekshiriladi (qisman muvaffaqiyat) — pipe emas, sxema bevosita
    const tekshirilgan = body.vazifalar.map((el) => YangiVazifaSxemasi.safeParse(el));
    const yaroqli = tekshirilgan.flatMap((t) => (t.success ? [t.data] : []));
    const yaratilgan = await this.xizmat.toplamYarat(yaroqli);
    let k = 0;
    const natijalar = tekshirilgan.map((t, indeks): Natija => {
      if (!t.success) return { indeks, holat: 422, xato: { joy: `body.vazifalar[${String(indeks)}]`, xabar: t.error.issues.map((i) => i.message).join("; ") } };
      const n = yaratilgan[k++];
      if (n === undefined) return { indeks, holat: 500 };
      return n.ok ? { indeks, holat: 201, vazifa: n.vazifa } : { indeks, holat: n.xato.holat, xato: { joy: `body.vazifalar[${String(indeks)}]`, xabar: n.xato.message } };
    });
    // dinamik status: passthrough bilan res.status() saqlanadi (holat 06 o'lchovi)
    res.status(natijalar.every((n) => n.holat === 201) ? 201 : 207);
    return { natijalar };
  }

  @ApiExcludeEndpoint() // 405 yordamchisi — OpenAPI hujjatida haqiqiy metodlarni ustidan yozmasin (#44)
  @All("toplam")
  toplamPostYoq(@Req() req: Request): never {
    throw new MetodYoqXatosi(req.method, "POST");
  }

  /**
   * #53 NS-52: Server-Sent Events — vazifa hodisalari jonli oqimi (frontend boshqa tabda o'zgarganini darhol ko'radi). /:id dan OLDIN.
   * "vazifa.*" (wildcard) — xizmat chiqaradigan hamma hodisa; har 25 s "ping" — proxy (nginx) bo'sh ulanishni uzmasin.
   * Mijoz uzilsa Nest obunani bekor qiladi → teardown tinglovchini olib tashlaydi (xotira oqmaydi). 28-qism: faqat o'z vazifalari
   */
  @Sse("oqim")
  oqim(): Observable<MessageEvent> {
    // B: hodisa egasi (xizmat emit'ning 2-argumenti) — boshqa foydalanuvchining vazifalari oqimga TUSHMAYDI (BOLA)
    const egasi = this.xizmat.egasi;
    const hodisalar = new Observable<MessageEvent>((obunachi) => {
      const tinglovchi = function (this: { event: string | string[] }, data: unknown, kimniki: unknown): void {
        if (kimniki !== egasi) return;
        obunachi.next({ type: String(this.event), data: data as object });
      };
      this.hodisalar.on("vazifa.*", tinglovchi);
      return () => { this.hodisalar.off("vazifa.*", tinglovchi); };
    });
    return merge(hodisalar, interval(25_000).pipe(map((): MessageEvent => ({ type: "ping", data: "" }))));
  }

  @Get(":id")
  @Header(...KESH)
  @UseInterceptors(VazifaSarlavhalariInterceptor)
  ol(@Param({ schema: IdSxemasi }) { id }: Id): Promise<Vazifa> {
    return this.xizmat.ol(id);
  }

  /** PUT — to'liq almashtirish (idempotent: 2 marta yuborish = 1 marta) */
  @Put(":id")
  @VazifaYozuvi()
  almashtir(@Param({ schema: IdSxemasi }) { id }: Id, @Body({ schema: ToliqVazifaSxemasi }) body: ToliqVazifa, @IfMatchShart() shart: Shart | undefined): Promise<Vazifa> {
    return this.xizmat.almashtir(id, body, shart);
  }

  /** PATCH — qisman (JSON Merge Patch). If-Match: "3" — faqat 3-versiya bo'lsa yoz */
  @Patch(":id")
  @VazifaYozuvi()
  yangila(@Param({ schema: IdSxemasi }) { id }: Id, @Body({ schema: OzgarishSxemasi }) body: VazifaOzgarishi, @IfMatchShart() shart: Shart | undefined): Promise<Vazifa> {
    return this.xizmat.yangila(id, body, shart);
  }

  @Delete(":id")
  @HttpCode(204)
  ochir(@Param({ schema: IdSxemasi }) { id }: Id, @IfMatchShart() shart: Shart | undefined): Promise<void> {
    return this.xizmat.ochir(id, shart);
  }

  @ApiExcludeEndpoint() // 405 yordamchisi — OpenAPI hujjatida haqiqiy metodlarni ustidan yozmasin (#44)
  @All(":id")
  birMetodYoq(@Req() req: Request): never {
    throw new MetodYoqXatosi(req.method, "GET, HEAD, PUT, PATCH, DELETE");
  }
}
