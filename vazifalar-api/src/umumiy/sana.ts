// sana.ts — saqlash UTC'da, foydalanuvchi esa "24-oktabr" deganda Toshkent kunini nazarda tutadi.
// Mahalliy kun chegarasi → UTC lahza (Temporal Node 24 da yo'q — Intl bilan; t40)

/** tz mintaqasining berilgan UTC lahzadagi siljishi (daqiqa): Asia/Tashkent → +300 */
export function siljish(tz: string, lahza: Date): number {
  const qismlar = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(lahza);
  const q = (tur: Intl.DateTimeFormatPartTypes): number => Number(qismlar.find((p) => p.type === tur)?.value);
  const mahalliy = Date.UTC(q("year"), q("month") - 1, q("day"), q("hour"), q("minute"), q("second"));
  return Math.round((mahalliy - Math.floor(lahza.getTime() / 1000) * 1000) / 60_000);
}

/** "2026-10-24" (tz bo'yicha kun) → shu kun boshlanishining UTC ISO lahzasi: Toshkent → "2026-10-23T19:00:00.000Z" */
export function kunBoshiUtc(sana: string, tz: string): string {
  const [y, m, d] = sana.split("-").map(Number);
  const taxmin = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
  // DST bo'lgan mintaqalarda siljish kunga qarab o'zgaradi — ikki marta hisoblaymiz
  const birinchi = taxmin - siljish(tz, new Date(taxmin)) * 60_000;
  return new Date(taxmin - siljish(tz, new Date(birinchi)) * 60_000).toISOString();
}

/** Keyingi kun (mahalliy kalendar bo'yicha) */
export function keyingiKun(sana: string): string {
  const [y, m, d] = sana.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + 1)).toISOString().slice(0, 10);
}
