// berish.ts — faylni foydalanuvchiga berish: S3 dan oqim, Range (206/416), Content-Disposition (UTF-8), nosniff; bir nechta faylni ZIP oqimi (B-145).
// Server orqali berish — huquq tekshiruvi har so'rovda; muqobil — presigned GET havola (s3.ts olishHavolasi), server trafigi yo'q.
import type { Response } from "express";
import { pipeline } from "node:stream/promises";
import { ZipArchive } from "archiver";
import { contentDisposition, type FaylOmbori } from "./s3.ts";

/** `bytes=a-b` | `bytes=a-` | `bytes=-n` — faqat bitta oraliq. Noto'g'ri sintaksis → undefined (RFC 9110: e'tiborsiz, to'liq 200). Qoniqtirib bo'lmas → "416". */
export function oraliqniTahlil(sarlavha: string | undefined, hajm: number): { bosh: number; oxir: number } | "416" | undefined {
  if (!sarlavha) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(sarlavha.trim());
  if (!m) return undefined;
  const [, a = "", b = ""] = m;
  if (a === "" && b === "") return undefined;
  if (a === "") {
    const n = Number(b);
    if (n === 0) return "416";
    return { bosh: Math.max(0, hajm - n), oxir: hajm - 1 };
  }
  const bosh = Number(a);
  const oxir = b === "" ? hajm - 1 : Math.min(Number(b), hajm - 1);
  if (bosh >= hajm || oxir < bosh) return "416";
  return { bosh, oxir };
}

export async function faylniBer(res: Response, ombor: FaylOmbori, f: { kalit: string; aslNom: string; mime: string; hajm: number }, range: string | undefined, inline = false): Promise<void> {
  const o = oraliqniTahlil(range, f.hajm);
  res.set({
    "Content-Type": f.mime,
    "Content-Disposition": contentDisposition(f.aslNom, inline && f.mime.startsWith("image/") ? "inline" : "attachment"),
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
  });
  if (o === "416") {
    res.status(416).set("Content-Range", `bytes */${String(f.hajm)}`).end();
    return;
  }
  const { oqim } = await ombor.oqi(f.kalit, o ? `bytes=${String(o.bosh)}-${String(o.oxir)}` : undefined);
  if (o) res.status(206).set({ "Content-Range": `bytes ${String(o.bosh)}-${String(o.oxir)}/${String(f.hajm)}`, "Content-Length": String(o.oxir - o.bosh + 1) });
  else res.status(200).set("Content-Length", String(f.hajm));
  await pipeline(oqim, res); // mijoz uzilsa — S3 oqimi ham yopiladi (pipeline destroy qiladi)
}

/** Bir nechta faylni ZIP qilib oqim bilan beradi; diskka ham xotiraga ham to'liq yig'ilmaydi. Rasmlar/PDF allaqachon siqilgan — `store`. */
export async function zipBer(res: Response, ombor: FaylOmbori, zipNomi: string, fayllar: { kalit: string; aslNom: string; mime: string }[]): Promise<void> {
  res.status(200).set({ "Content-Type": "application/zip", "Content-Disposition": contentDisposition(zipNomi), "X-Content-Type-Options": "nosniff" });
  const zip = new ZipArchive({ zlib: { level: 6 } });
  const ish = pipeline(zip, res);
  const nomlar = new Set<string>();
  for (const f of fayllar) {
    const { oqim } = await ombor.oqi(f.kalit);
    zip.append(oqim, { name: noyobNom(f.aslNom, nomlar), store: !f.mime.startsWith("text/") });
  }
  await zip.finalize();
  await ish;
}

/** ZIP ichida bir xil nom ikki marta bo'lmasin: `a.png`, `a (2).png`. Yo'l belgilari olib tashlanadi (zip slip — ochganda papkadan chiqish). */
export function noyobNom(nom: string, band: Set<string>): string {
  const toza = nom.replace(/[/\\]/g, "_").replace(/^\.+/, "") || "fayl";
  let n = toza;
  for (let i = 2; band.has(n.toLowerCase()); i++) {
    const nuqta = toza.lastIndexOf(".");
    n = nuqta > 0 ? `${toza.slice(0, nuqta)} (${String(i)})${toza.slice(nuqta)}` : `${toza} (${String(i)})`;
  }
  band.add(n.toLowerCase());
  return n;
}
