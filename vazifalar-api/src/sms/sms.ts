// sms.ts — SMS provayder abstraksiyasi: Eskiz (token, 401 da yangilash), PlayMobile (Basic auth), raqam normallash, segment hisobi (B-150).
// Eskiz protokoli — notify.eskiz.uz Postman hujjati (2026-10-27 o'qildi); PlayMobile — ochiq hujjat topilmadi, umumiy shakl (mock bilan sinalgan, haqiqiy API — SINALMAGAN).

export type SmsNatija = { provayderId: string; holat: "kutilmoqda" | "yuborildi" };
export type YetkazishHolati = "yetkazildi" | "yetkazilmadi" | "kutilmoqda";

export interface SmsProvayder {
  readonly nom: string;
  yubor(telefon: string, matn: string, bizningId: string): Promise<SmsNatija>;
}

export class SmsXato extends Error {
  readonly qaytaUrinish: boolean;
  readonly status: number | undefined;
  constructor(xabar: string, qaytaUrinish: boolean, status?: number) {
    super(xabar);
    this.name = "SmsXato";
    this.qaytaUrinish = qaytaUrinish;
    this.status = status;
  }
}

/** O'zbekiston raqami → `998XXXXXXXXX` (12 raqam). Boshqa shakl — undefined (xalqaro SMS — alohida endpoint va narx). */
export function raqamNormallash(kirish: string): string | undefined {
  const r = kirish.replace(/[\s()+-]/g, "");
  const toliq = /^\d{9}$/.test(r) ? `998${r}` : r;
  // operator kodlari ro'yxati (90, 91, 33, 77, 88 …) vaqt o'tishi bilan kengayadi — qat'iy ro'yxat yozilmaydi
  return /^998\d{9}$/.test(toliq) ? toliq : undefined;
}

// GSM 03.38 asosiy jadvali (kengaytma belgilari 2 o'rin egallaydi)
const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_KENG = "^{}\\[~]|€";

/**
 * Segmentlar: GSM-7 — 160 (bo'linsa 153), aks holda UCS-2 — 70 (bo'linsa 67). O'zbekcha `ʻ` (U+02BB) yoki kirill bitta belgi
 * butun xabarni UCS-2 ga o'tkazadi — narx 2+ barobar. ASCII apostrof `'` — GSM'da bor.
 */
export function segmentlar(matn: string): { kodlash: "GSM-7" | "UCS-2"; uzunlik: number; segment: number } {
  let gsm = true;
  let uz = 0;
  for (const ch of matn) {
    if (GSM.includes(ch)) uz += 1;
    else if (GSM_KENG.includes(ch)) uz += 2;
    else { gsm = false; break; }
  }
  if (gsm) return { kodlash: "GSM-7", uzunlik: uz, segment: uz <= 160 ? 1 : Math.ceil(uz / 153) };
  const u = Array.from(matn).reduce((a, c) => a + ((c.codePointAt(0) ?? 0) > 0xffff ? 2 : 1), 0);
  return { kodlash: "UCS-2", uzunlik: u, segment: u <= 70 ? 1 : Math.ceil(u / 67) };
}

type FetchFn = typeof fetch;

/** Eskiz: login → Bearer token (hujjat: 30 kun). 401 bo'lsa — bir marta qayta login va takror. Token xotirada (bir nechta instansda — har biri o'zi oladi). */
export class EskizProvayder implements SmsProvayder {
  readonly nom = "eskiz";
  #token: string | undefined;
  #tokenOlish: Promise<string> | undefined;
  readonly #s: { baseUrl: string; email: string; parol: string; from: string; callbackUrl?: string; fetchFn?: FetchFn; kutishMs?: number };

  constructor(s: { baseUrl: string; email: string; parol: string; from: string; callbackUrl?: string; fetchFn?: FetchFn; kutishMs?: number }) {
    this.#s = s;
  }

  get #f(): FetchFn {
    return this.#s.fetchFn ?? globalThis.fetch;
  }

  /** Parallel so'rovlar bitta login'ni kutadi (aks holda 10 SMS = 10 login). */
  async #olToken(yangi = false): Promise<string> {
    if (!yangi && this.#token) return this.#token;
    this.#tokenOlish ??= (async () => {
      try {
        const fd = new FormData();
        fd.append("email", this.#s.email);
        fd.append("password", this.#s.parol);
        const r = await this.#f(`${this.#s.baseUrl}/api/auth/login`, { method: "POST", body: fd, signal: AbortSignal.timeout(this.#s.kutishMs ?? 10_000) });
        if (!r.ok) throw new SmsXato(`Eskiz login: HTTP ${String(r.status)}`, r.status >= 500, r.status);
        const j = (await r.json()) as { data?: { token?: string } };
        if (!j.data?.token) throw new SmsXato("Eskiz login: token yo'q", false);
        this.#token = j.data.token;
        return j.data.token;
      } finally {
        this.#tokenOlish = undefined;
      }
    })();
    return this.#tokenOlish;
  }

  async yubor(telefon: string, matn: string, bizningId: string): Promise<SmsNatija> {
    const tel = raqamNormallash(telefon);
    if (!tel) throw new SmsXato(`noto'g'ri raqam: ${telefon}`, false);
    const sorov = async (token: string) => {
      const fd = new FormData();
      fd.append("mobile_phone", tel);
      fd.append("message", matn);
      fd.append("from", this.#s.from);
      if (this.#s.callbackUrl) fd.append("callback_url", `${this.#s.callbackUrl}?id=${encodeURIComponent(bizningId)}`);
      return this.#f(`${this.#s.baseUrl}/api/message/sms/send`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd, signal: AbortSignal.timeout(this.#s.kutishMs ?? 10_000) });
    };
    let r = await sorov(await this.#olToken());
    if (r.status === 401) r = await sorov(await this.#olToken(true));
    if (!r.ok) {
      const matnXato = await r.text();
      throw new SmsXato(`Eskiz yuborish: HTTP ${String(r.status)} ${matnXato.slice(0, 200)}`, r.status === 429 || r.status >= 500, r.status);
    }
    const j = (await r.json()) as { id?: string; status?: string };
    if (!j.id) throw new SmsXato("Eskiz javobida id yo'q", false);
    return { provayderId: j.id, holat: "kutilmoqda" };
  }

  /** Callback (`status`: DELIVRD, UNDELIV, EXPIRED, REJECTD, DELETED — hujjatdagi qism holatlari) → bizning holat. */
  static callbackHolati(status: string): YetkazishHolati {
    if (status === "DELIVRD" || status === "DELIVERED") return "yetkazildi";
    if (["UNDELIV", "EXPIRED", "REJECTD", "REJECTED", "DELETED"].includes(status)) return "yetkazilmadi";
    return "kutilmoqda";
  }
}

/** PlayMobile (broker): Basic auth + JSON `messages[]`. Ochiq hujjat topilmadi — shakl uchinchi tomon klientlari va mock bo'yicha. */
export class PlayMobileProvayder implements SmsProvayder {
  readonly nom = "playmobile";
  readonly #s: { baseUrl: string; login: string; parol: string; originator: string; fetchFn?: FetchFn };
  constructor(s: { baseUrl: string; login: string; parol: string; originator: string; fetchFn?: FetchFn }) {
    this.#s = s;
  }
  async yubor(telefon: string, matn: string, bizningId: string): Promise<SmsNatija> {
    const tel = raqamNormallash(telefon);
    if (!tel) throw new SmsXato(`noto'g'ri raqam: ${telefon}`, false);
    const r = await (this.#s.fetchFn ?? globalThis.fetch)(`${this.#s.baseUrl}/broker-api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${this.#s.login}:${this.#s.parol}`).toString("base64")}` },
      body: JSON.stringify({ messages: [{ recipient: tel, "message-id": bizningId, sms: { originator: this.#s.originator, content: { text: matn } } }] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new SmsXato(`PlayMobile: HTTP ${String(r.status)}`, r.status === 429 || r.status >= 500, r.status);
    return { provayderId: bizningId, holat: "kutilmoqda" };
  }
}

/** Zaxira (failover): birinchisi qayta urinib bo'ladigan xato bersa — keyingisi. Tasdiqlanmagan (4xx) xatoda to'xtaydi. */
export class ZaxiraliSms implements SmsProvayder {
  readonly nom = "zaxirali";
  readonly #lar: SmsProvayder[];
  constructor(...provayderlar: SmsProvayder[]) {
    this.#lar = provayderlar;
  }
  async yubor(telefon: string, matn: string, bizningId: string): Promise<SmsNatija & { provayder: string }> {
    let oxirgi: unknown;
    for (const p of this.#lar) {
      try {
        return { ...(await p.yubor(telefon, matn, bizningId)), provayder: p.nom };
      } catch (e) {
        oxirgi = e;
        if (e instanceof SmsXato && !e.qaytaUrinish) throw e;
      }
    }
    throw oxirgi instanceof Error ? oxirgi : new Error(String(oxirgi));
  }
}
