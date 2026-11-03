// webhook.ts — tashqi HTTP: vazifa bajarilganda WEBHOOK_URL ga POST (masalan Telegram bot serveri — 29-qism).
// 29-qism B (holat 35): server endi buni ULAMAYDI — foydalanuvchi obunalari (src/webhook/). Bu yerda Xabarchi turi va 25-qism mock darsining
// namunasi (test/mock.test.ts — fetch tikuvi) qoldi.
// Javobni kutmaydi (fire-and-forget), lekin xatoni yutmaydi — logga yozadi. fetchFn — tikuv (seam): testda soxtasi beriladi.
// 28 #28: sukut yo'l — xavfsizPost (SSRF himoyasi: ichki IP, DNS rebinding, redirect qayta tekshiruvi). URL hozir config'dan (admin) — lekin 29-qismda
// foydalanuvchi o'z webhook/bot manzilini kiritadi: himoya oldindan.
import type { Log } from "./log.ts";
import type { Vazifa } from "../vazifalar/vazifa.ts";
import { xavfsizPost } from "./xavfsiz-url.ts";

/** 29-qism B (holat 35): to'rt hodisa (avval faqat "vazifa.bajarildi") */
export type VazifaHodisasi = "vazifa.yaratildi" | "vazifa.yangilandi" | "vazifa.bajarildi" | "vazifa.ochirildi";
export type Xabarchi = (hodisa: VazifaHodisasi, vazifa: Vazifa) => void;

type Yubor = (url: string, tana: string, kutishMs: number) => Promise<{ status: number }>;

export function webhookXabarchi(url: string, { fetchFn, kutishMs = 2000, log, httpRuxsat = false }: { fetchFn?: typeof fetch; kutishMs?: number; log: () => Pick<Log, "warn" | "info">; httpRuxsat?: boolean }): Xabarchi {
  const yubor: Yubor = fetchFn === undefined
    ? (u, tana, ms) => xavfsizPost(u, tana, { kutishMs: ms, httpRuxsat })
    : async (u, tana, ms) => {
      const javob = await fetchFn(u, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "vazifalar-api/1" }, body: tana, signal: AbortSignal.timeout(ms) });
      void javob.body?.cancel(); // tanani o'qimaymiz — ulanish bo'shasin
      return { status: javob.status };
    };
  return (hodisa, vazifa) => {
    if (hodisa !== "vazifa.bajarildi") return; // 25-qism shartnomasi: faqat bajarilganda
    const l = log(); // so'rov konteksti (sorovId) — javob ketgandan keyin ham shu logger
    yubor(url, JSON.stringify({ hodisa, vaqt: new Date().toISOString(), vazifa: { id: vazifa.id, matn: vazifa.matn } }), kutishMs).then(
      (javob) => {
        if (javob.status >= 200 && javob.status < 300) l.info({ hodisa, vazifaId: vazifa.id, status: javob.status }, "webhook yuborildi");
        else l.warn({ hodisa, vazifaId: vazifa.id, status: javob.status }, "webhook rad etildi");
      },
      (xato: unknown) => {
        l.warn({ hodisa, vazifaId: vazifa.id, err: xato }, "webhook yuborilmadi");
      },
    );
  };
}
