// royxat-mantiq.ts — xotiradagi (va fayldagi) omborlar uchun filtr, saralash, offset va keyset sahifalash.
// Toza funksiyalar: massiv kiradi — natija chiqadi. Postgres ombori (26-qism) buni SQL'da qiladi (WHERE, ORDER BY, LIMIT)
import type { Filtr, KursorQiymati, RoyxatNatija, RoyxatSorovi, Saralash } from "./ombor.ts";
import type { Vazifa } from "./vazifa.ts";

export function filtrla(vazifalar: readonly Vazifa[], filtr: Filtr): Vazifa[] {
  const qidiruv = filtr.qidiruv?.toLowerCase();
  return vazifalar.filter(
    (v) =>
      (filtr.bajarildi === undefined || v.bajarildi === filtr.bajarildi) &&
      (filtr.teglar === undefined || filtr.teglar.every((t) => v.teglar.includes(t))) &&
      (qidiruv === undefined || v.matn.toLowerCase().includes(qidiruv)) &&
      // ISO UTC satrlar (bir xil format, Z) leksikografik solishtirish = vaqt bo'yicha
      (filtr.yaratildiDan === undefined || v.yaratildi >= filtr.yaratildiDan) &&
      (filtr.yaratildiGacha === undefined || v.yaratildi < filtr.yaratildiGacha),
  );
}

/** Saralash kalitlari + id (oxirgi kalit — tenglikda ham tartib barqaror bo'lsin) */
export function kalitlar(saralash: readonly Saralash[]): Saralash[] {
  // Sukut — foydalanuvchi tartibi (frontend sudrab tartiblaydi)
  if (saralash.length === 0) return [{ maydon: "tartib", kamayish: false }, { maydon: "id", kamayish: false }];
  const k = saralash.filter((s) => s.maydon !== "id");
  const id = saralash.find((s) => s.maydon === "id");
  return [...k, id ?? { maydon: "id", kamayish: false }];
}

function solishtir(a: string | number | boolean, b: string | number | boolean): number {
  // Satrlar — kod nuqtasi bo'yicha (localeCompare emas): deterministik. Postgres collation boshqacha
  // tartiblashi mumkin — 26-qismda kursor DB tartibi bilan mos bo'lishi kerak
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function kalitQiymatlari(v: Vazifa, k: readonly Saralash[]): KursorQiymati {
  return k.map((s) => v[s.maydon]);
}

/** a kalitlari b dan saralash tartibida oldinmi (<0), tengmi (0), keyinmi (>0) */
function tartibda(a: KursorQiymati, b: KursorQiymati, k: readonly Saralash[]): number {
  for (const [i, s] of k.entries()) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return 0;
    const n = solishtir(x, y);
    if (n !== 0) return s.kamayish ? -n : n;
  }
  return 0;
}

export function sahifala(hammasi: readonly Vazifa[], sorov: RoyxatSorovi): Omit<RoyxatNatija, "versiya"> {
  const k = kalitlar(sorov.saralash);
  const mos = filtrla(hammasi, sorov.filtr).sort((a, b) => tartibda(kalitQiymatlari(a, k), kalitQiymatlari(b, k), k));
  let boshi = 0;
  if (sorov.sahifa.tur === "offset") {
    boshi = sorov.sahifa.offset;
  } else if (sorov.sahifa.keyin !== undefined) {
    const keyin = sorov.sahifa.keyin;
    // Keyset: kursordan qat'iy keyingi birinchi qator (kursor qatori o'chirilgan bo'lsa ham ishlaydi)
    const i = mos.findIndex((v) => tartibda(kalitQiymatlari(v, k), keyin, k) > 0);
    boshi = i === -1 ? mos.length : i;
  }
  const sahifa = mos.slice(boshi, boshi + sorov.limit);
  const borKeyingi = boshi + sorov.limit < mos.length;
  const oxirgi = sahifa.at(-1);
  const natija: Omit<RoyxatNatija, "versiya"> = { vazifalar: structuredClone(sahifa), borKeyingi };
  if (borKeyingi && oxirgi !== undefined) natija.keyingi = kalitQiymatlari(oxirgi, k);
  if (sorov.jami === true) natija.jami = mos.length;
  return natija;
}
