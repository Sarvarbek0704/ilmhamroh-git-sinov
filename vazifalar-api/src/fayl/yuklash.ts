// yuklash.ts — multipart faylni xotiraga to'plamasdan, busboy → (tur tekshiruvi + sha256 + hajm) → S3 multipart oqimi (B-137).
// Xotira: fayl hajmidan qat'iy nazar ~ partSize × queueSize (5 MB × 2). Limit oshsa yoki mijoz uzilsa — S3 yuklash bekor qilinadi
// (`leavePartsOnError: false` → AbortMultipartUpload), bucket'da chala qism qolmaydi.
import type { IncomingMessage } from "node:http";
import { PassThrough, Transform, type Readable, type TransformCallback } from "node:stream";
import { createHash, type Hash } from "node:crypto";
import busboy from "busboy";
import { BOSH_BAYT, faylNomiTozala, turniAniqla } from "./xavfsizlik.ts";
import type { FaylOmbori } from "./s3.ts";

export class YuklashXato extends Error {
  readonly status: 400 | 413 | 415 | 499;
  readonly kod: string;
  constructor(status: 400 | 413 | 415 | 499, kod: string, xabar: string) {
    super(xabar);
    this.name = "YuklashXato";
    this.status = status;
    this.kod = kod;
  }
}

export type YuklashNatija = {
  kalit: string;
  aslNom: string;
  mime: string;
  hajm: number;
  sha256: string;
  maydonlar: Record<string, string>;
};

export type YuklashSozlama = {
  ombor: FaylOmbori;
  maksHajm: number;
  /** kengaytma → saqlash kaliti (masalan `saqlashKaliti(egasiId, k, "vaqtincha")`) */
  kalit: (kengaytma: string) => string;
  maydonNomi?: string;
  progress?: (yuklandi: number) => void;
};

/** sha256 va bayt sonini oqim o'tayotganda hisoblaydi. */
class Sanagich extends Transform {
  readonly hash: Hash = createHash("sha256");
  bayt = 0;
  override _transform(bolak: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.hash.update(bolak);
    this.bayt += bolak.length;
    cb(null, bolak);
  }
}

/** Oqim boshidan kamida `n` bayt (yoki butun fayl, agar qisqa bo'lsa) yig'adi va oqimni to'xtatib turadi. */
function boshiniOl(oqim: Readable, n: number): Promise<{ bosh: Buffer; tugadi: boolean }> {
  return new Promise((ok, yoq) => {
    const bolaklar: Buffer[] = [];
    let uzunlik = 0;
    const tozala = () => { oqim.off("data", onData); oqim.off("end", onEnd); oqim.off("error", onError); };
    const onData = (b: Buffer) => {
      bolaklar.push(b);
      uzunlik += b.length;
      if (uzunlik >= n) { oqim.pause(); tozala(); ok({ bosh: Buffer.concat(bolaklar), tugadi: false }); }
    };
    const onEnd = () => { tozala(); ok({ bosh: Buffer.concat(bolaklar), tugadi: true }); };
    const onError = (e: Error) => { tozala(); yoq(e); };
    oqim.on("data", onData).on("end", onEnd).on("error", onError);
  });
}

export function oqimliYuklash(req: IncomingMessage, s: YuklashSozlama): Promise<YuklashNatija> {
  const maydonNomi = s.maydonNomi ?? "fayl";
  return new Promise<YuklashNatija>((ok, yoq) => {
    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers: req.headers, limits: { fileSize: s.maksHajm, files: 1, fields: 10, fieldSize: 10_000, parts: 12 } });
    } catch {
      yoq(new YuklashXato(400, "multipart-emas", "Content-Type multipart/form-data bo'lishi kerak"));
      return;
    }
    const ac = new AbortController();
    const maydonlar: Record<string, string> = {};
    let ish: Promise<YuklashNatija> | undefined;
    let tugadi = false;
    const bitir = (x: YuklashXato) => { if (!tugadi) { tugadi = true; ac.abort(x); yoq(x); } };

    bb.on("field", (nom, qiymat) => { maydonlar[nom] = qiymat; });
    bb.on("filesLimit", () => { bitir(new YuklashXato(400, "kop-fayl", "Faqat bitta fayl yuboring")); });
    bb.on("fieldsLimit", () => { bitir(new YuklashXato(400, "kop-maydon", "Maydonlar juda ko'p")); });
    bb.on("partsLimit", () => { bitir(new YuklashXato(400, "kop-qism", "Qismlar juda ko'p")); });
    bb.on("file", (nom, fayl, info) => {
      if (nom !== maydonNomi || ish) { fayl.resume(); bitir(new YuklashXato(400, "kutilmagan-maydon", `Fayl '${maydonNomi}' maydonida bo'lishi kerak`)); return; }
      fayl.on("limit", () => { bitir(new YuklashXato(413, "katta-fayl", `Fayl ${String(s.maksHajm)} baytdan katta`)); fayl.resume(); });
      ish = (async () => {
        const { bosh, tugadi: qisqa } = await boshiniOl(fayl, BOSH_BAYT);
        const tur = await turniAniqla(bosh, info.mimeType);
        if (!tur.ok) {
          fayl.resume(); // qolganini o'qib tashlaymiz — aks holda so'rov osilib qoladi
          throw new YuklashXato(415, tur.sabab, `Fayl turi qabul qilinmaydi (${tur.topildi ?? tur.sabab})`);
        }
        const sanagich = new Sanagich();
        const kirish = new PassThrough();
        kirish.pipe(sanagich);
        kirish.write(bosh);
        if (qisqa) kirish.end();
        else fayl.pipe(kirish);
        const kalit = s.kalit(tur.kengaytma);
        await s.ombor.yoz(kalit, sanagich, tur.mime, {
          signal: ac.signal,
          meta: { "asl-nom": encodeURIComponent(faylNomiTozala(info.filename ?? "fayl")) },
          ...(s.progress ? { progress: s.progress } : {}),
        });
        return { kalit, aslNom: faylNomiTozala(info.filename ?? "fayl"), mime: tur.mime, hajm: sanagich.bayt, sha256: sanagich.hash.digest("hex"), maydonlar };
      })();
      ish.catch((e: unknown) => { bitir(e instanceof YuklashXato ? e : new YuklashXato(400, "yuklash-xatosi", e instanceof Error ? e.message : String(e))); });
    });
    bb.on("close", () => {
      if (tugadi) return;
      if (!ish) { bitir(new YuklashXato(400, "fayl-yoq", `'${maydonNomi}' maydonida fayl yo'q`)); return; }
      ish.then((n) => { if (!tugadi) { tugadi = true; ok({ ...n, maydonlar }); } }, () => { /* bitir() allaqachon chaqirilgan */ });
    });
    bb.on("error", (e: unknown) => { bitir(new YuklashXato(400, "buzilgan-multipart", e instanceof Error ? e.message : String(e))); });
    req.on("close", () => { if (!req.complete) bitir(new YuklashXato(499, "mijoz-uzildi", "Mijoz so'rovni oxirigacha yubormadi")); });
    req.pipe(bb);
  });
}
