// fayl.controller.ts — 30 C (29-qism B holat 06 `marshrut.ts` ning Nest shakli; mantiq va SQL o'zgarmadi): vazifa ilovalari va presigned yuklash.
//   POST   /v1/vazifalar/:vazifaId/ilovalar            multipart (maydon "fayl") → oqim bilan S3 → fayllar (dedup) → vazifa_ilovalari
//   GET    /v1/vazifalar/:vazifaId/ilovalar            ro'yxat
//   GET    /v1/vazifalar/:vazifaId/ilovalar.zip        hammasi ZIP oqimi
//   GET    /v1/vazifalar/:vazifaId/ilovalar/:faylId    server orqali berish (Range, attachment); ?havola=1 — muddatli presigned havola (JSON)
//   DELETE /v1/vazifalar/:vazifaId/ilovalar/:faylId    ilovani olish (fayl yetim bo'lib qoladi — tozalash #48)
//   POST   /v1/fayllar/forma                           brauzer to'g'ridan S3 ga (presigned POST): fayllar'da 'kutilmoqda' yozuv
//   POST   /v1/fayllar/:faylId/tasdiq                  HEAD + Range + magic bytes + sha256 → 'tayyor' (+ ixtiyoriy vazifaga biriktirish)
// Egasi — @Egasi() (28 sessiyasi yoki API kaliti; anonim — global KirishGuard 401). Har baza amali RLS ostida (egasiSifatida) VA `AND egasi_id = $n`
// (29 holat 06 topilmasi: faqat RLS'ga tayanish — RLS'siz pool bilan begona ro'yxat ochilib qolgan edi).
// Nest farqi: multipart — Multer/FileInterceptor EMAS (u faylni xotira/diskka to'liq yig'adi; bizda oqim to'g'ridan S3 ga, busboy) — `@Req()` oqimi;
// javob — `@Res()` (Range 206, ZIP oqimi, Location). Xatolar IlovaXatosi → global ProblemDetailsFilter.
import { Controller, Delete, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { z } from "zod";
import { IlovaXatosi, TopilmadiXatosi } from "../umumiy/xatolar.ts";
import { tekshir } from "../umumiy/tekshir.ts";
import { egasiSifatida } from "../umumiy/rls.ts";
import { Egasi } from "../umumiy/egasi.ts";
import { Cheklov } from "../auth/cheklov.guard.ts";
import { API_CHEKLOVI } from "../auth/qoriqchi.ts";
import { FAYLLAR } from "../tokenlar.ts";
import { oqimliYuklash, YuklashXato } from "./yuklash.ts";
import { BOSH_BAYT, RUXSAT_ETILGAN, faylNomiTozala, saqlashKaliti, turniAniqla } from "./xavfsizlik.ts";
import type { FaylOmbori } from "./s3.ts";
import { biriktir, ilovaniOl, ilovalar, IlovaXato, tayyorFaylYoz } from "./metama.ts";
import { faylniBer, zipBer } from "./berish.ts";

export type FaylBogliqliklari = { ombor: FaylOmbori; pool: Pool; maksHajm: number };

const IdP = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const idOl = (req: Request, nom: "vazifaId" | "faylId"): number => tekshir(IdP, (req.params as Record<string, string | undefined>)[nom], "params");

/** metama.ts va yuklash.ts xatolari → Problem Details (IlovaXatosi — global filtr taniydi) */
function xatoniAylantir(x: unknown): never {
  if (x instanceof YuklashXato) {
    const status = x.status === 499 ? 400 : x.status;
    throw new IlovaXatosi(status, x.message, { kod: x.kod, sarlavha: status === 413 ? "Fayl juda katta" : status === 415 ? "Fayl turi qabul qilinmaydi" : "Noto'g'ri so'rov" });
  }
  if (x instanceof IlovaXato) {
    if (x.kod === "topilmadi") throw new TopilmadiXatosi(x.message, "topilmadi");
    throw new IlovaXatosi(409, x.message, { kod: x.kod === "limit" ? "ilova-limiti" : "fayl-tayyor-emas", sarlavha: "Ilovani qo'shib bo'lmaydi" });
  }
  throw x;
}

// RLS + WHERE egasi_id — ikki qatlam (pg-ombor kabi): RLS o'chiq rol bilan ham begona vazifa ko'rinmaydi
async function vazifaBormi(pool: Pool, egasi: number, vazifaId: number): Promise<void> {
  const r = await egasiSifatida(pool, egasi, (c) => c.query("SELECT 1 FROM vazifalar WHERE id = $1 AND egasi_id = $2 AND ochirilgan_vaqt IS NULL", [vazifaId, egasi]));
  if (r.rowCount === 0) throw new TopilmadiXatosi("Vazifa topilmadi", "topilmadi");
}

@Controller("vazifalar/:vazifaId")
@Cheklov(API_CHEKLOVI)
export class IlovalarController {
  constructor(@Inject(FAYLLAR) private readonly b: FaylBogliqliklari) {}

  @Post("ilovalar")
  async yukla(@Egasi() egasi: number, @Req() req: Request, @Res() res: Response): Promise<void> {
    const b = this.b;
    const vazifaId = idOl(req, "vazifaId");
    // Yuklashdan OLDIN: vazifa yo'q bo'lsa baytlarni S3 ga yozmaymiz (aks holda yetim obyekt)
    await vazifaBormi(b.pool, egasi, vazifaId);
    const n = await oqimliYuklash(req, { ombor: b.ombor, maksHajm: b.maksHajm, kalit: (k) => saqlashKaliti(egasi, k, "fayllar") }).catch(xatoniAylantir);
    try {
      const natija = await egasiSifatida(b.pool, egasi, async (c) => {
        const t = await tayyorFaylYoz(c, { egasiId: egasi, kalit: n.kalit, mime: n.mime, hajm: n.hajm, sha256: n.sha256 });
        await biriktir(c, egasi, vazifaId, t.fayl.id, n.aslNom);
        return t;
      });
      // Dublikat: bazada eski obyekt qoldi — yangi yuklangan nusxa keraksiz
      if (natija.dublikat) await b.ombor.ochir(n.kalit);
      res.status(201).location(`/v1/vazifalar/${String(vazifaId)}/ilovalar/${String(natija.fayl.id)}`)
        .json({ faylId: natija.fayl.id, aslNom: n.aslNom, mime: n.mime, hajm: n.hajm, dublikat: natija.dublikat });
    } catch (x) {
      // Baza rad etdi (limit, poyga) — S3 dagi yangi obyekt yetim; o'chiramiz (aks holda — kunlik tozalash)
      await b.ombor.ochir(n.kalit).catch(() => undefined);
      xatoniAylantir(x);
    }
  }

  @Get("ilovalar")
  async royxat(@Egasi() egasi: number, @Req() req: Request): Promise<object> {
    const vazifaId = idOl(req, "vazifaId");
    await vazifaBormi(this.b.pool, egasi, vazifaId);
    const l = await egasiSifatida(this.b.pool, egasi, (c) => ilovalar(c, egasi, vazifaId));
    return { ilovalar: l.map((i) => ({ faylId: i.faylId, aslNom: i.aslNom, mime: i.mime, hajm: i.hajm, qoshilgan: i.qoshilgan, havola: `/v1/vazifalar/${String(vazifaId)}/ilovalar/${String(i.faylId)}` })) };
  }

  /** ".zip" — alohida yo'l (`:faylId` dan OLDIN e'lon qilinadi; path-to-regexp 8 da nuqta — oddiy belgi) */
  @Get("ilovalar.zip")
  async zip(@Egasi() egasi: number, @Req() req: Request, @Res() res: Response): Promise<void> {
    const vazifaId = idOl(req, "vazifaId");
    await vazifaBormi(this.b.pool, egasi, vazifaId);
    const l = await egasiSifatida(this.b.pool, egasi, (c) => ilovalar(c, egasi, vazifaId));
    await zipBer(res, this.b.ombor, `vazifa-${String(vazifaId)}-ilovalar.zip`, l);
  }

  @Get("ilovalar/:faylId")
  async ber(@Egasi() egasi: number, @Req() req: Request, @Res() res: Response): Promise<void> {
    const vazifaId = idOl(req, "vazifaId");
    const faylId = idOl(req, "faylId");
    const l = await egasiSifatida(this.b.pool, egasi, (c) => ilovalar(c, egasi, vazifaId));
    const f = l.find((i) => i.faylId === faylId);
    if (f === undefined) throw new TopilmadiXatosi("Ilova topilmadi", "topilmadi");
    if (req.query["havola"] === "1") {
      // Katta fayl / CDN: server trafigisiz — 5 daqiqalik imzolangan havola (Content-Disposition imzo ichida)
      res.json({ url: await this.b.ombor.olishHavolasi(f.kalit, 300, f.aslNom), muddatSoniya: 300 });
      return;
    }
    await faylniBer(res, this.b.ombor, f, req.get("range"), req.query["inline"] === "1");
  }

  @Delete("ilovalar/:faylId")
  async olib(@Egasi() egasi: number, @Req() req: Request, @Res() res: Response): Promise<void> {
    const vazifaId = idOl(req, "vazifaId");
    const faylId = idOl(req, "faylId");
    const ok = await egasiSifatida(this.b.pool, egasi, (c) => ilovaniOl(c, egasi, vazifaId, faylId));
    if (!ok) throw new TopilmadiXatosi("Ilova topilmadi", "topilmadi");
    res.status(204).end();
  }
}

const FormaSxemasi = z.strictObject({
  nom: z.string().min(1).max(255),
  tur: z.enum(Object.keys(RUXSAT_ETILGAN) as [keyof typeof RUXSAT_ETILGAN, ...(keyof typeof RUXSAT_ETILGAN)[]]),
  hajm: z.number().int().positive(),
});
const TasdiqSxemasi = z.strictObject({ vazifaId: z.number().int().positive().optional(), aslNom: z.string().min(1).max(255).optional() });

@Controller("fayllar")
@Cheklov(API_CHEKLOVI)
export class FayllarController {
  constructor(@Inject(FAYLLAR) private readonly b: FaylBogliqliklari) {}

  @Post("forma")
  async forma(@Egasi() egasi: number, @Req() req: Request, @Res() res: Response): Promise<void> {
    const b = this.b;
    const t = { data: tekshir(FormaSxemasi, req.body, "body") };
    if (t.data.hajm > b.maksHajm) throw new IlovaXatosi(413, `Fayl ${String(b.maksHajm)} baytdan katta`, { kod: "katta-fayl", sarlavha: "Fayl juda katta" });
    const kalit = saqlashKaliti(egasi, RUXSAT_ETILGAN[t.data.tur], "vaqtincha");
    const id = await egasiSifatida(b.pool, egasi, async (c) =>
      (await c.query<{ id: number }>("INSERT INTO fayllar (egasi_id, kalit, mime, hajm) VALUES ($1, $2, $3, $4) RETURNING id", [egasi, kalit, t.data.tur, t.data.hajm])).rows[0]?.id);
    const forma = await b.ombor.yuklashFormasi(kalit, t.data.tur, b.maksHajm, 300);
    res.status(201).json({ faylId: id, aslNom: faylNomiTozala(t.data.nom), url: forma.url, maydonlar: forma.fields, muddatSoniya: 300 });
  }

  @Post(":faylId/tasdiq")
  // Nest POST sukuti 201 — @Res() bilan ham (status handler'dan OLDIN qo'yiladi; 29 da Express sukuti 200 edi — test ushladi)
  @HttpCode(200)
  async tasdiq(@Egasi() egasi: number, @Req() req: Request, @Res() res: Response): Promise<void> {
    const b = this.b;
    const faylId = idOl(req, "faylId");
    const t = { data: tekshir(TasdiqSxemasi, req.body ?? {}, "body") };
    const f = (await egasiSifatida(b.pool, egasi, (c) => c.query<{ kalit: string; mime: string; holat: string }>("SELECT kalit, mime, holat FROM fayllar WHERE id = $1 AND egasi_id = $2", [faylId, egasi]))).rows[0];
    if (f === undefined) throw new TopilmadiXatosi("Fayl topilmadi", "topilmadi");
    if (f.holat === "tayyor") { res.json({ faylId, holat: "tayyor" }); return; } // takroriy tasdiq — idempotent
    const ma = await b.ombor.ma(f.kalit);
    if (ma === undefined) throw new IlovaXatosi(409, "Fayl hali yuklanmagan", { kod: "yuklanmagan", sarlavha: "Fayl yo'q" });
    const rad = async (sabab: string): Promise<never> => {
      await b.ombor.ochir(f.kalit);
      await egasiSifatida(b.pool, egasi, (c) => c.query("DELETE FROM fayllar WHERE id = $1 AND egasi_id = $2", [faylId, egasi]));
      throw new IlovaXatosi(415, sabab, { kod: "tur-mos-emas", sarlavha: "Fayl turi qabul qilinmaydi" });
    };
    if (ma.hajm > b.maksHajm || ma.hajm < 1) await rad("hajm chegaradan tashqarida");
    // Magic bytes — birinchi 4 100 bayt (Range); keyin to'liq sha256 (dedup uchun; ≤ maksHajm)
    const { oqim: bosh } = await b.ombor.oqi(f.kalit, `bytes=0-${String(BOSH_BAYT - 1)}`);
    const bolaklar: Buffer[] = [];
    for await (const x of bosh) bolaklar.push(x as Buffer);
    const tur = await turniAniqla(Buffer.concat(bolaklar), f.mime);
    if (!tur.ok || tur.mime !== f.mime) await rad(`e'lon qilingan tur ${f.mime}, haqiqiy: ${tur.ok ? tur.mime : tur.sabab}`);
    const h = createHash("sha256");
    for await (const x of (await b.ombor.oqi(f.kalit)).oqim) h.update(x as Buffer);
    const sha = h.digest("hex");
    const doimiy = f.kalit.replace(/^vaqtincha\//, "fayllar/");
    await b.ombor.kochir(f.kalit, doimiy);
    const natija = await egasiSifatida(b.pool, egasi, async (c) => {
      const dub = (await c.query<{ id: number }>("SELECT id FROM fayllar WHERE egasi_id = $1 AND sha256 = decode($2, 'hex') AND id <> $3", [egasi, sha, faylId])).rows[0];
      if (dub) {
        await c.query("DELETE FROM fayllar WHERE id = $1 AND egasi_id = $2", [faylId, egasi]);
        return { id: dub.id, dublikat: true };
      }
      await c.query("UPDATE fayllar SET kalit = $2, hajm = $3, sha256 = decode($4, 'hex'), holat = 'tayyor', tasdiqlangan_vaqt = now() WHERE id = $1 AND egasi_id = $5", [faylId, doimiy, ma.hajm, sha, egasi]);
      return { id: faylId, dublikat: false };
    });
    await b.ombor.ochir(f.kalit);
    if (natija.dublikat) await b.ombor.ochir(doimiy);
    if (t.data.vazifaId !== undefined) {
      const vid = t.data.vazifaId;
      await egasiSifatida(b.pool, egasi, (c) => biriktir(c, egasi, vid, natija.id, faylNomiTozala(t.data.aslNom ?? "fayl"))).catch(xatoniAylantir);
    }
    res.json({ faylId: natija.id, holat: "tayyor", dublikat: natija.dublikat });
  }
}
