// yuboruvchilar.ts — 29-qism B (holat 18): bildirishnoma markazining kanal yuboruvchilari — mavjud modullar ustida yupqa adapterlar.
// Natija turlari markazga: yuborildi / eskirgan (manzilni o'chirish) / qayta (vaqtinchalik) / xato (doimiy). Telegram — holat 22 (bot).
import type { Pochta } from "../email/pochta.ts";
import { SHABLONLAR, shablonKompilyatsiya } from "../email/pochta.ts";
import { obunaTokeni } from "../email/obuna.ts";
import type { WebPush } from "../push/webpush.ts";
import { SmsXato, type SmsProvayder } from "../sms/sms.ts";
import { smsIdYarat } from "../sms/ulash.ts";
import type { Kanal, Yuboruvchi } from "./markaz.ts";

const XAT = shablonKompilyatsiya(SHABLONLAR.bildirishnoma);

/** Email: shablon + one-click obunadan chiqish (RFC 8058). Message-ID — bildirishnoma id'sidan (qayta urinishda bir xil) */
export function emailYuboruvchi(pochta: Pochta, o: { obunaKaliti: Buffer; apiUrl: string; ilovaUrl: string }): Yuboruvchi {
  return async (q, x) => {
    const obunaBekor = `${o.apiUrl}/v1/obuna/${obunaTokeni(o.obunaKaliti, q.foydalanuvchiId, "email")}`;
    try {
      const r = await pochta.yubor({
        kimga: q.email,
        xat: XAT({ sarlavha: x.sarlavha, matn: x.matn, havola: `${o.ilovaUrl}${x.havola ?? "/"}`, obunaBekor }),
        obunaBekor,
        idempotentlikKaliti: `bildirishnoma-${String(x.id)}`,
      });
      return r.rad.length > 0 ? { holat: "xato", sabab: "SMTP qabul qilmadi" } : { holat: "yuborildi" };
    } catch (e) {
      // SMTP 4xx (vaqtinchalik) va tarmoq — qayta; 5xx (doimiy, masalan 550 manzil yo'q) — xato
      const kod = (e as { responseCode?: number }).responseCode;
      return kod !== undefined && kod >= 500 ? { holat: "xato", sabab: `SMTP ${String(kod)}` } : { holat: "qayta", sabab: e instanceof Error ? e.message : String(e) };
    }
  };
}

/** Push: har obunaga; eskirgan (404/410) — markaz o'sha obunani o'chiradi. Bittasi yetsa — yuborildi */
export function pushYuboruvchi(wp: WebPush): Yuboruvchi {
  return async (q, x) => {
    let yetdi = false;
    for (const p of q.pushlar) {
      const n = await wp.yubor({ endpoint: p.endpoint, keys: { p256dh: p.p256dh, auth: p.auth } }, { sarlavha: x.sarlavha, matn: x.matn, url: x.havola ?? "/", teg: x.tur });
      if (n.tur === "eskirgan") return { holat: "eskirgan", pushId: p.id };
      if (n.tur === "qayta") return { holat: "qayta", sabab: `push ${String(n.status)}` };
      if (n.tur === "yetkazildi") yetdi = true;
    }
    return yetdi ? { holat: "yuborildi" } : { holat: "xato", sabab: "push obunasi yo'q yoki rad etildi" };
  };
}

/** SMS: matn qisqa (bitta segmentga intilamiz), bizning id — imzoli "b<bildirishnoma>.<hmac>" (callback shu bilan qaytadi, ulash.ts) */
export function smsYuboruvchi(p: SmsProvayder, kalit: Buffer): Yuboruvchi {
  return async (q, x) => {
    if (q.telefon === null) return { holat: "xato", sabab: "telefon yo'q" };
    try {
      await p.yubor(q.telefon, `${x.sarlavha}: ${x.matn}`.slice(0, 160), smsIdYarat(kalit, x.id));
      return { holat: "yuborildi" };
    } catch (e) {
      if (e instanceof SmsXato && e.qaytaUrinish) return { holat: "qayta", sabab: e.message };
      return { holat: "xato", sabab: e instanceof Error ? e.message : String(e) };
    }
  };
}

export type Yuboruvchilar = Partial<Record<Kanal, Yuboruvchi>>;
