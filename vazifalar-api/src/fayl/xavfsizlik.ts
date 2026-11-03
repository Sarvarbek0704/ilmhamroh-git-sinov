// xavfsizlik.ts — yuklangan faylga ishonmaslik: turi magic bytes bo'yicha, nom faqat ko'rsatish uchun, saqlash kaliti tasodifiy.
// Kengaytma va Content-Type — mijoz yozgan matn, ularga qarab qaror qilinmaydi (B-136).
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";

/** Ruxsat etilgan turlar: MIME → saqlashda ishlatiladigan kengaytma. SVG va HTML ataylab yo'q (ichida skript bo'lishi mumkin). */
export const RUXSAT_ETILGAN = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
} as const;
export type RuxsatTur = keyof typeof RUXSAT_ETILGAN;

/** Turni aniqlash uchun boshidan shuncha bayt yetadi (file-type ko'p formatni 4 100 baytda taniydi). */
export const BOSH_BAYT = 4100;

export type TurNatija =
  | { ok: true; mime: RuxsatTur; kengaytma: string }
  | { ok: false; sabab: "noma'lum-tur" | "ruxsat-yoq" | "matn-emas" | "belgilash-tili"; topildi?: string };

const isRuxsat = (m: string): m is RuxsatTur => Object.hasOwn(RUXSAT_ETILGAN, m);

/**
 * Faylning birinchi baytlari bo'yicha turini aniqlaydi. `elon` — mijoz aytgan Content-Type (faqat matn fayli uchun ishora sifatida).
 * Ikkilik format topilsa — o'shaniki hal qiladi (exe'ni `image/png` deb yuborsa ham). Hech narsa topilmasa va mijoz `text/plain` desa —
 * haqiqatan UTF-8 matnmi va `<` bilan boshlanmaydimi (HTML/SVG) — tekshiriladi.
 */
export async function turniAniqla(bosh: Uint8Array, elon: string): Promise<TurNatija> {
  const topildi = await fileTypeFromBuffer(bosh);
  if (topildi) {
    return isRuxsat(topildi.mime) ? { ok: true, mime: topildi.mime, kengaytma: RUXSAT_ETILGAN[topildi.mime] } : { ok: false, sabab: "ruxsat-yoq", topildi: topildi.mime };
  }
  if (elon.split(";")[0]?.trim().toLowerCase() !== "text/plain") return { ok: false, sabab: "noma'lum-tur" };
  if (bosh.includes(0)) return { ok: false, sabab: "matn-emas" };
  // bosh qismi BOSH_BAYT chegarasida kesilgan bo'lsa, oxirgi UTF-8 belgi chala bo'lishi mumkin — `stream: true` chala oxirni xato demaydi
  let matn: string;
  try {
    matn = new TextDecoder("utf-8", { fatal: true }).decode(bosh, { stream: bosh.length >= BOSH_BAYT });
  } catch {
    return { ok: false, sabab: "matn-emas" };
  }
  if (BELGILASH_BOSHI.test(matn)) return { ok: false, sabab: "belgilash-tili" };
  return { ok: true, mime: "text/plain", kengaytma: "txt" };
}

const WINDOWS_ZAXIRA = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
// Boshqaruv belgilari, yo'l ajratgichlar, Windows taqiqlagan belgilar, nol kenglikdagi va bidi belgilari (U+202E RLO: `hisobot<RLO>fdp.exe`
// ekranda "hisobotexe.pdf" ko'rinadi). Kod nuqtalari raqam bilan — manbada ko'rinmas belgi bo'lmasin.
const kp = (a: number, b: number) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`;
const YOMON_BELGI = new RegExp(String.raw`[\x00-\x1F\x7F<>:"/\\|?*` + kp(0x200b, 0x200f) + kp(0x202a, 0x202e) + kp(0x2066, 0x2069) + "]", "g");
const BELGILASH_BOSHI = new RegExp(`^${String.fromCodePoint(0xfeff)}?` + String.raw`\s*<`);

/**
 * Asl nomni FAQAT ko'rsatish va `Content-Disposition` uchun tozalaydi. Diskka/bucket'ga bu nom bilan YOZILMAYDI.
 * NFC, yo'l qismlari tashlanadi, xavfli belgilar `_`, boshidagi/oxiridagi nuqta va bo'shliq olinadi, 120 belgigacha (kengaytma saqlanadi).
 */
export function faylNomiTozala(nom: string, maks = 120): string {
  const oxirgi = nom.normalize("NFC").split(/[/\\]/).at(-1) ?? "";
  let toza = oxirgi.replace(YOMON_BELGI, "_").replace(/^[.\s]+|[.\s]+$/g, "");
  const nuqta = toza.lastIndexOf(".");
  const asos = nuqta > 0 ? toza.slice(0, nuqta) : toza;
  const kengaytma = nuqta > 0 ? toza.slice(nuqta) : "";
  if (WINDOWS_ZAXIRA.test(asos)) toza = `_${toza}`;
  const belgilar = Array.from(toza); // kod nuqtalari (emoji klasterlari emas — fayl nomi uchun yetarli)
  if (belgilar.length > maks) {
    const k = Array.from(kengaytma).slice(0, 16).join("");
    toza = Array.from(asos).slice(0, maks - Array.from(k).length).join("") + k;
  }
  return toza === "" || toza === "_" ? "fayl" : toza;
}

/** Saqlash kaliti — foydalanuvchi bergan nomdan mustaqil: `vazifalar/<egasi>/<uuid>.<kengaytma>`. */
export function saqlashKaliti(egasiId: number | string, kengaytma: string, prefiks = "vazifalar"): string {
  if (!/^[a-z0-9]{1,8}$/.test(kengaytma)) throw new TypeError(`noto'g'ri kengaytma: ${kengaytma}`);
  return `${prefiks}/${String(egasiId)}/${randomUUID()}.${kengaytma}`;
}
