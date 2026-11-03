// s3.ts — S3 mos ombor (MinIO lokal, AWS S3 / Cloudflare R2 prodda) ustidagi yupqa qatlam.
// Bucket private: o'qish/yozish faqat server kaliti yoki muddatli imzolangan havola (presigned) bilan (B-138, B-139).
import { Readable } from "node:stream";
import {
  S3Client, CreateBucketCommand, HeadBucketCommand, GetObjectCommand, HeadObjectCommand,
  DeleteObjectCommand, CopyObjectCommand, ListObjectsV2Command, S3ServiceException,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost, type PresignedPost } from "@aws-sdk/s3-presigned-post";

export type S3Sozlama = { endpoint?: string; region: string; kalit: string; sir: string; bucket: string; pathStyle?: boolean };

export type ObyektMa = { hajm: number; tur: string | undefined; etag: string | undefined; meta: Record<string, string> };

export class FaylOmbori {
  readonly s3: S3Client;
  readonly bucket: string;

  constructor(s: S3Sozlama) {
    this.bucket = s.bucket;
    this.s3 = new S3Client({
      region: s.region,
      ...(s.endpoint === undefined ? {} : { endpoint: s.endpoint }),
      forcePathStyle: s.pathStyle ?? s.endpoint !== undefined, // MinIO: http://host:port/bucket/kalit
      credentials: { accessKeyId: s.kalit, secretAccessKey: s.sir },
    });
  }

  /** Bucket bo'lmasa yaratadi (lokal/test uchun; prodda bucket infratuzilma kodi bilan yaratiladi). */
  async tayyorla(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (e) {
      if (!topilmadimi(e)) throw e;
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  /** Oqimni (yoki buferni) yuklaydi. Hajm noma'lum oqim uchun multipart (`lib-storage`), `signal` bilan bekor qilinadi. */
  async yoz(kalit: string, tana: Readable | Uint8Array | string, tur: string, opts: { meta?: Record<string, string>; signal?: AbortSignal; progress?: (yuklandi: number) => void } = {}): Promise<{ etag: string | undefined }> {
    const up = new Upload({
      client: this.s3,
      params: { Bucket: this.bucket, Key: kalit, Body: tana, ContentType: tur, ...(opts.meta ? { Metadata: opts.meta } : {}) },
      partSize: 5 * 1024 * 1024,
      queueSize: 2,
      leavePartsOnError: false, // xatoda AbortMultipartUpload — chala qismlar bucket'da qolmaydi
      ...(opts.signal ? { abortController: abortControllerDan(opts.signal) } : {}),
    });
    if (opts.progress) {
      const p = opts.progress;
      up.on("httpUploadProgress", (h) => { p(h.loaded ?? 0); });
    }
    const r = await up.done();
    return { etag: r.ETag };
  }

  async oqi(kalit: string, oraliq?: string): Promise<{ oqim: Readable; hajm: number | undefined; tur: string | undefined; oraliq: string | undefined }> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: kalit, ...(oraliq ? { Range: oraliq } : {}) }));
    if (!(r.Body instanceof Readable)) throw new Error("S3 javobi Node oqimi emas");
    return { oqim: r.Body, hajm: r.ContentLength, tur: r.ContentType, oraliq: r.ContentRange };
  }

  /** Obyekt ma'lumoti yoki `undefined` (yo'q bo'lsa). */
  async ma(kalit: string): Promise<ObyektMa | undefined> {
    try {
      const h = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: kalit }));
      return { hajm: h.ContentLength ?? 0, tur: h.ContentType, etag: h.ETag, meta: h.Metadata ?? {} };
    } catch (e) {
      if (topilmadimi(e)) return undefined;
      throw e;
    }
  }

  /** S3 da DeleteObject idempotent — yo'q kalit ham 204. */
  async ochir(kalit: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: kalit }));
  }

  async kochir(manba: string, nishon: string): Promise<void> {
    await this.s3.send(new CopyObjectCommand({ Bucket: this.bucket, CopySource: `${this.bucket}/${encodeURI(manba)}`, Key: nishon }));
  }

  async *kalitlar(prefiks: string): AsyncGenerator<{ kalit: string; hajm: number; vaqt: Date | undefined }> {
    let token: string | undefined;
    do {
      const l = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefiks, ...(token ? { ContinuationToken: token } : {}) }));
      for (const o of l.Contents ?? []) if (o.Key) yield { kalit: o.Key, hajm: o.Size ?? 0, vaqt: o.LastModified };
      token = l.NextContinuationToken;
    } while (token);
  }

  /**
   * Brauzer to'g'ridan bucket'ga yuklashi uchun presigned POST: hajm oralig'i va Content-Type SHART sifatida imzolanadi —
   * presigned PUT da hajmni cheklab bo'lmaydi (B-139).
   */
  async yuklashFormasi(kalit: string, tur: string, maksHajm: number, muddatSoniya = 300): Promise<PresignedPost> {
    return createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: kalit,
      Conditions: [["content-length-range", 1, maksHajm], ["eq", "$Content-Type", tur]],
      Fields: { "Content-Type": tur },
      Expires: muddatSoniya,
    });
  }

  /** Yuklab olish uchun muddatli havola; `faylNomi` berilsa — Content-Disposition attachment (RFC 6266/5987, UTF-8 nom). */
  async olishHavolasi(kalit: string, muddatSoniya = 300, faylNomi?: string): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: kalit, ...(faylNomi ? { ResponseContentDisposition: contentDisposition(faylNomi) } : {}) }),
      { expiresIn: muddatSoniya },
    );
  }
}

/** `attachment; filename="ascii"; filename*=UTF-8''foiz-kodlangan` — eski brauzerlar ASCII zaxirasini oladi. */
export function contentDisposition(nom: string, tur: "attachment" | "inline" = "attachment"): string {
  let ascii = nom.normalize("NFKD").replace(/[^\x20-\x7E]/g, "").replace(/["\\]/g, "_").trim();
  if (ascii === "" || ascii.startsWith(".")) ascii = `fayl${ascii}`; // "Ўқиш.txt" → ".txt" bo'lib qolmasin (t11 topilmasi)
  const utf8 = encodeURIComponent(nom).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `${tur}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export function topilmadimi(e: unknown): boolean {
  return e instanceof S3ServiceException && (e.$metadata.httpStatusCode === 404 || e.name === "NoSuchKey" || e.name === "NotFound" || e.name === "NoSuchBucket");
}

function abortControllerDan(signal: AbortSignal): AbortController {
  const ac = new AbortController();
  if (signal.aborted) ac.abort(signal.reason);
  else signal.addEventListener("abort", () => { ac.abort(signal.reason); }, { once: true });
  return ac;
}
