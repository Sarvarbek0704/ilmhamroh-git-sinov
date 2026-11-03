// csv.ts — RFC 4180: ajratgich, qo'shtirnoq yoki yangi qator bo'lsa — qo'shtirnoq ichida, " → ""
export function csvMaydon(x: string | number | boolean, ajratgich = ","): string {
  const s = String(x);
  return s.includes(ajratgich) || /["\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function csvQator(maydonlar: readonly (string | number | boolean)[], ajratgich = ","): string {
  return maydonlar.map((m) => csvMaydon(m, ajratgich)).join(ajratgich) + "\r\n";
}
