// taqiqlangan-parollar.ts — #05: keng tarqalgan / taxmin qilinadigan parollar (NIST: "blocklist"). To'liq ro'yxat (HIBP Pwned Passwords — k-anonymity
// range API, faqat SHA-1 ning 5 belgisi yuboriladi) — tashqi xizmat; kanonda SINALMAGAN (lokal ish qoidasi), interfeys darsda. Bu yerda: kichik lokal ro'yxat +
// qoida tekshiruvlari (bitta belgi takrori, ketma-ketlik, foydalanuvchining o'z ma'lumoti, xizmat nomi).

// 15+ belgili mashhur parollar va naqshlar (sizib chiqqan ro'yxatlardagi uzunlari; kichik harfda solishtiriladi)
const ROYXAT = new Set([
  "123456789012345", "1234567890123456", "qwertyuiopasdfgh", "qwertyuiopasdfghjkl", "1q2w3e4r5t6y7u8i", "1qaz2wsx3edc4rfv", "zaq12wsxcde34rfv",
  "passwordpassword", "password1234567", "password12345678", "iloveyouiloveyou", "aaaaaaaaaaaaaaa", "abcdefghijklmnop", "qwerty123456789",
  "parolparolparol", "parol1234567890", "mening-parolim-123", "menparolimniunutdim", "uzbekistan2026!!", "toshkent12345678", "assalomualaykum1",
  "letmeinletmein12", "administrator123", "welcome123456789", "changeme12345678",
]);

const XIZMAT = ["vazifalar", "ilmhamroh", "vazifalar-api"];

function ketmaKetmi(p: string): boolean {
  // "abcdefghijklmnop", "123456789…", "987654…" — har keyingi belgi kodi ±1
  let osish = 0;
  let kamayish = 0;
  for (let i = 1; i < p.length; i++) {
    const d = p.charCodeAt(i) - p.charCodeAt(i - 1);
    if (d === 1) osish++;
    if (d === -1) kamayish++;
  }
  return osish >= p.length - 2 || kamayish >= p.length - 2;
}

/**
 * @param shaxsiy foydalanuvchining o'z ma'lumoti (email, ism) — parolda bo'lmasin
 * @returns sabab matni yoki undefined (ruxsat)
 */
export function taqiqlanganmi(parol: string, shaxsiy: readonly string[] = []): string | undefined {
  const p = parol.toLowerCase();
  if (ROYXAT.has(p)) return "bu parol keng tarqalgan (sizib chiqqan ro'yxatlarda bor) — boshqasini tanlang";
  if (new Set(p).size <= 3) return "parolda turli belgilar juda kam";
  if (ketmaKetmi(p)) return "parol oddiy ketma-ketlik (abc…, 123…)";
  for (const s of XIZMAT) if (p.includes(s)) return "parolda xizmat nomi bo'lmasin";
  for (const s of shaxsiy) {
    const bolak = s.toLowerCase().split(/[@\s.]+/).filter((x) => x.length >= 4);
    for (const b of bolak) if (p.includes(b)) return "parolda email yoki ismingiz bo'lmasin";
  }
  return undefined;
}
