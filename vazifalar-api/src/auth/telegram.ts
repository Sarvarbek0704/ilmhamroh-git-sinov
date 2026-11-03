// telegram.ts — #16 B-120 (holat 16): Telegram Login Widget va Mini App initData imzosini tekshirish — core.telegram.org hujjatidagi algoritmlar.
// Haqiqiy bot (BotFather) va token ishlatilmagan — testlar o'zimiz yaratgan SOXTA token bilan imzolangan namunalar (SINALMAGAN: haqiqiy Telegram ma'lumoti).
//   Login Widget (core.telegram.org/widgets/login): secret_key = SHA256(bot_token); hash = hex(HMAC_SHA256(secret_key, data_check_string)).
//   Mini App (core.telegram.org/bots/webapps): secret_key = HMAC_SHA256(kalit "WebAppData", xabar bot_token); hash = hex(HMAC_SHA256(secret_key, data_check_string)).
//   data_check_string — "hash" dan tashqari hamma maydon, kalit bo'yicha alifbo tartibida, "kalit=qiymat", "\n" bilan.
//   Third-party (tokensiz): signature = base64url Ed25519(`${bot_id}:WebAppData\n` + hash va signature'siz maydonlar), Telegram ochiq kaliti bilan.
// Muddat: auth_date eski bo'lsa — rad (o'g'irlangan/qayta o'ynatilgan ma'lumot). Solishtirish — timingSafeEqual.
import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";

/** Telegram hujjatidagi ochiq kalitlar (hex, Ed25519) — third-party tekshiruv uchun */
export const TELEGRAM_OCHIQ_KALIT = Object.freeze({
  production: "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d",
  test: "40055058a4ee38156a06562e52eece92a771bcd8346a8c4615cb7376eddf72ec",
});

export type TelegramFoydalanuvchi = { id: number; ism: string; username?: string | undefined };
export type TekshiruvNatijasi = { tur: "ok"; foydalanuvchi: TelegramFoydalanuvchi; authDate: number } | { tur: "xato"; sabab: "imzo" | "eskirgan" | "maydon" };

function tekshiruvSatri(maydonlar: ReadonlyMap<string, string>, tashla: readonly string[]): string {
  return [...maydonlar].filter(([k]) => !tashla.includes(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
}

function hexTeng(a: string, b: Buffer): boolean {
  if (!/^[0-9a-f]{64}$/.test(a)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), b);
}

function muddat(authDate: string | undefined, maksS: number, hozirS: number): number | undefined {
  if (authDate === undefined || !/^\d{1,12}$/.test(authDate)) return undefined;
  const t = Number(authDate);
  return hozirS - t > maksS || t - hozirS > 60 ? undefined : t; // kelajakdagi vaqt (soat farqi 60 s dan ko'p) ham rad
}

/** Login Widget: maydonlar (id, first_name, last_name, username, photo_url, auth_date, hash) — JSON yoki query'dan, hammasi satr */
export function widgetTekshir(maydon: Record<string, string>, botToken: string, maksS: number, hozirS = Math.floor(Date.now() / 1000)): TekshiruvNatijasi {
  const m = new Map(Object.entries(maydon));
  const hash = m.get("hash");
  if (hash === undefined || m.get("id") === undefined) return { tur: "xato", sabab: "maydon" };
  const kalit = createHash("sha256").update(botToken).digest();
  if (!hexTeng(hash, createHmac("sha256", kalit).update(tekshiruvSatri(m, ["hash"])).digest())) return { tur: "xato", sabab: "imzo" };
  const t = muddat(m.get("auth_date"), maksS, hozirS);
  if (t === undefined) return { tur: "xato", sabab: "eskirgan" };
  const id = Number(m.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return { tur: "xato", sabab: "maydon" };
  const ism = [m.get("first_name"), m.get("last_name")].filter((x) => x !== undefined && x !== "").join(" ");
  return { tur: "ok", foydalanuvchi: { id, ism: ism === "" ? `Telegram ${String(id)}` : ism, username: m.get("username") }, authDate: t };
}

/** Mini App: Telegram.WebApp.initData satri (URL-encoded query). Hujjat: data_check_string'dan faqat "hash" chiqariladi */
export function initDataTekshir(initData: string, botToken: string, maksS: number, hozirS = Math.floor(Date.now() / 1000)): TekshiruvNatijasi {
  const m = new Map(new URLSearchParams(initData));
  const hash = m.get("hash");
  if (hash === undefined) return { tur: "xato", sabab: "maydon" };
  const kalit = createHmac("sha256", "WebAppData").update(botToken).digest();
  if (!hexTeng(hash, createHmac("sha256", kalit).update(tekshiruvSatri(m, ["hash"])).digest())) return { tur: "xato", sabab: "imzo" };
  return natija(m, maksS, hozirS);
}

/** Third-party: bot tokenisiz — Telegram ochiq kaliti (Ed25519) bilan `signature` maydoni */
export function initDataImzoTekshir(initData: string, botId: number, ochiqKalitHex: string, maksS: number, hozirS = Math.floor(Date.now() / 1000)): TekshiruvNatijasi {
  const m = new Map(new URLSearchParams(initData));
  const imzo = m.get("signature");
  if (imzo === undefined) return { tur: "xato", sabab: "maydon" };
  // Ed25519 ochiq kaliti (32 bayt) → SPKI DER (12 baytlik prefiks + kalit)
  const kalit = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(ochiqKalitHex, "hex")]), format: "der", type: "spki" });
  const satr = `${String(botId)}:WebAppData\n${tekshiruvSatri(m, ["hash", "signature"])}`;
  if (!verify(null, Buffer.from(satr), kalit, Buffer.from(imzo, "base64url"))) return { tur: "xato", sabab: "imzo" };
  return natija(m, maksS, hozirS);
}

function natija(m: ReadonlyMap<string, string>, maksS: number, hozirS: number): TekshiruvNatijasi {
  const t = muddat(m.get("auth_date"), maksS, hozirS);
  if (t === undefined) return { tur: "xato", sabab: "eskirgan" };
  let u: unknown;
  try {
    u = JSON.parse(m.get("user") ?? "null");
  } catch {
    return { tur: "xato", sabab: "maydon" };
  }
  if (typeof u !== "object" || u === null || !("id" in u) || typeof u.id !== "number" || !Number.isSafeInteger(u.id)) return { tur: "xato", sabab: "maydon" };
  const ism = "first_name" in u && typeof u.first_name === "string" ? u.first_name : `Telegram ${String(u.id)}`;
  const username = "username" in u && typeof u.username === "string" ? u.username : undefined;
  return { tur: "ok", foydalanuvchi: { id: u.id, ism, username }, authDate: t };
}
