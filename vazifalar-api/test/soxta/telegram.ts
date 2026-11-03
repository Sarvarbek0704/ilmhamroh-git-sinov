// soxta/telegram.ts — Telegram Bot API'ning lokal MOCK serveri (core.telegram.org/bots/api shakli bo'yicha). HAQIQIY token, BotFather, Telegram serveri YO'Q.
// grammY `new Bot(token, { client: { apiRoot: soxta.url } })` bilan ulanadi: POST {apiRoot}/bot<token>/<method> (JSON yoki multipart), fayl: GET {apiRoot}/file/bot<token>/<path>.
// Foydalanuvchi tomoni: `yozadi`, `bosadi`, `inline`, `tolaydi` → Update navbatga (getUpdates) yoki webhook'ga (X-Telegram-Bot-Api-Secret-Token bilan) ketadi.
// Qo'llanadigan cheklovlar (hujjatdagi qiymatlar): matn 4096, caption 1024, callback_data 1–64 bayt, getFile 20 MB, yuklash 50 MB, webhook bor paytda getUpdates → 409.
// TAXMINIY (haqiqiy server bilan solishtirilmagan): 429 chegarasi (chat: 1 xabar/s, 3 ta portlash; global 30/s) va retry_after qiymati, xato matnlarining aniq so'zlari,
// HTML parse xatosidagi bayt ofseti, guruh/kanal huquqlari (faqat a'zolik ro'yxati), inline natijalar keshi — yo'q.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

type Obj = Record<string, unknown>;
export type Xabar = { message_id: number; chat: { id: number; type: string }; text?: string; caption?: string; photo?: Obj[]; document?: Obj; reply_markup?: Obj; parse_mode?: string; date: number; media_group_id?: string; invoice?: Obj };
export type Chaqiruv = { method: string; params: Obj; vaqt: number };

/** Parametrni satrga: JSON parse qilingan qiymat ham bo'lishi mumkin */
const satr = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v));

const HTML_TEGLAR = new Set(["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "a", "code", "pre", "tg-spoiler", "span", "blockquote", "tg-emoji"]);

/** Telegram HTML parse_mode qoidasi: ruxsat etilgan teglar, `<`, `>`, `&` — faqat entity sifatida (&lt; &gt; &amp; &quot;). */
export function htmlTekshir(matn: string): string | undefined {
  const stek: string[] = [];
  const re = /<(\/?)([a-zA-Z-]+)([^>]*)>|&(?!(?:lt|gt|amp|quot|#\d+|#x[\da-fA-F]+);)|<|>/g;
  for (const m of matn.matchAll(re)) {
    const [butun, yopuvchi, teg] = m;
    if (butun === "&") return `can't parse entities: Can't find end of the entity starting at byte offset ${String(Buffer.byteLength(matn.slice(0, m.index)))}`;
    if (butun === "<" || butun === ">") return `can't parse entities: Unsupported start tag at byte offset ${String(Buffer.byteLength(matn.slice(0, m.index)))}`;
    const t = (teg ?? "").toLowerCase();
    if (!HTML_TEGLAR.has(t)) return `can't parse entities: Unsupported start tag "${t}" at byte offset ${String(Buffer.byteLength(matn.slice(0, m.index)))}`;
    if (yopuvchi) { if (stek.pop() !== t) return `can't parse entities: Can't find end tag corresponding to start tag "${t}"`; }
    else stek.push(t);
  }
  return stek.length ? `can't parse entities: Can't find end tag corresponding to start tag "${stek.at(-1) ?? ""}"` : undefined;
}

class ApiXato extends Error {
  readonly kod: number;
  readonly params: Obj | undefined;
  constructor(kod: number, tavsif: string, params?: Obj) { super(tavsif); this.kod = kod; this.params = params; }
}

export type SoxtaTelegram = Awaited<ReturnType<typeof soxtaTelegram>>;

export async function soxtaTelegram(o: { token: string; username?: string; chegara?: { chatSoniyada: number; portlash: number; globalSoniyada: number } | false } ) {
  const BOT = { id: Number(o.token.split(":")[0]), is_bot: true, first_name: "Vazifalar", username: o.username ?? "vazifalar_soxta_bot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: true };
  const chegara = o.chegara === false ? undefined : (o.chegara ?? { chatSoniyada: 1, portlash: 3, globalSoniyada: 30 });
  const navbat: Obj[] = [];
  let updateId = 1000;
  let xabarId = 1;
  let webhook: { url: string; secret?: string; allowed?: string[] } | undefined;
  const kutuvchilar: (() => void)[] = [];
  const chaqiruvlar: Chaqiruv[] = [];
  const chatlar = new Map<number, Xabar[]>();
  const bloklagan = new Set<number>();
  const fayllar = new Map<string, { bayt: Buffer; path: string; unique: string }>();
  const callbackJavob = new Map<string, Obj>();
  const preCheckout = new Map<string, Obj>();
  const inlineJavob = new Map<string, Obj>();
  const chatChelak = new Map<number, { t: number[] }>();
  const globalT: number[] = [];
  const webhookYetkazish: { status: number; update_id: unknown }[] = [];

  const updateQosh = (u: Obj) => {
    const upd = { update_id: ++updateId, ...u };
    if (webhook) {
      const w = webhook;
      void fetch(w.url, { method: "POST", headers: { "content-type": "application/json", ...(w.secret ? { "X-Telegram-Bot-Api-Secret-Token": w.secret } : {}) }, body: JSON.stringify(upd) })
        .then((r) => { webhookYetkazish.push({ status: r.status, update_id: upd.update_id }); void r.body?.cancel(); }, () => { webhookYetkazish.push({ status: 0, update_id: upd.update_id }); });
    } else {
      navbat.push(upd);
      for (const k of kutuvchilar.splice(0)) k();
    }
    return upd.update_id;
  };

  const limitTekshir = (chatId: number) => {
    if (!chegara) return;
    const hozir = Date.now();
    while (globalT.length && (globalT[0] ?? 0) < hozir - 1000) globalT.shift();
    if (globalT.length >= chegara.globalSoniyada) throw new ApiXato(429, "Too Many Requests: retry after 1", { retry_after: 1 });
    const ch = chatChelak.get(chatId) ?? { t: [] };
    ch.t = ch.t.filter((x) => x > hozir - 1000 * chegara.portlash / chegara.chatSoniyada);
    if (ch.t.length >= chegara.portlash) {
      const kut = Math.max(1, Math.ceil(((ch.t[0] ?? hozir) + 1000 * chegara.portlash / chegara.chatSoniyada - hozir) / 1000));
      throw new ApiXato(429, `Too Many Requests: retry after ${String(kut)}`, { retry_after: kut });
    }
    ch.t.push(hozir);
    chatChelak.set(chatId, ch);
    globalT.push(hozir);
  };

  const markupTekshir = (rm: unknown) => {
    const r = rm as { inline_keyboard?: { text?: string; callback_data?: string; url?: string }[][] } | undefined;
    for (const qator of r?.inline_keyboard ?? []) for (const t of qator) {
      if (t.callback_data !== undefined && (Buffer.byteLength(t.callback_data) < 1 || Buffer.byteLength(t.callback_data) > 64)) throw new ApiXato(400, "Bad Request: BUTTON_DATA_INVALID");
      if (!t.text) throw new ApiXato(400, "Bad Request: text buttons are unallowed in the inline keyboard");
    }
  };

  const xabarYoz = (chatId: number, x: Omit<Xabar, "message_id" | "chat" | "date">): Xabar => {
    if (bloklagan.has(chatId)) throw new ApiXato(403, "Forbidden: bot was blocked by the user");
    if (chatId < 0 && !chatlar.has(chatId)) throw new ApiXato(400, "Bad Request: chat not found");
    limitTekshir(chatId);
    const m: Xabar = { message_id: xabarId++, chat: { id: chatId, type: chatId < 0 ? "supergroup" : "private" }, date: Math.floor(Date.now() / 1000), ...x };
    const l = chatlar.get(chatId) ?? [];
    l.push(m);
    chatlar.set(chatId, l);
    return m;
  };

  const faylSaqla = (bayt: Buffer, papka: string, kengaytma: string) => {
    if (bayt.length > 50 * 1024 * 1024) throw new ApiXato(413, "Request Entity Too Large");
    const id = `SOXTA${randomBytes(12).toString("base64url")}`;
    const f = { bayt, path: `${papka}/file_${String(fayllar.size)}.${kengaytma}`, unique: randomBytes(6).toString("base64url") };
    fayllar.set(id, f);
    return { file_id: id, file_unique_id: f.unique, file_size: bayt.length };
  };
  // multipart: fayl maydoni alohida nom bilan keladi, parametrda "attach://<nom>" (grammY shunday yuboradi)
  const mediaOl = (v: unknown, f: Map<string, Buffer>, papka: string, kengaytma: string) => {
    if (typeof v === "string" && v.startsWith("attach://")) {
      const b = f.get(v.slice(9));
      if (!b) throw new ApiXato(400, "Bad Request: attach not found");
      return faylSaqla(b, papka, kengaytma);
    }
    if (Buffer.isBuffer(v)) return faylSaqla(v, papka, kengaytma);
    if (typeof v === "string") {
      const f = fayllar.get(v);
      if (!f) throw new ApiXato(400, "Bad Request: wrong file identifier/HTTP URL specified");
      return { file_id: v, file_unique_id: f.unique, file_size: f.bayt.length };
    }
    throw new ApiXato(400, "Bad Request: there is no photo in the request");
  };

  const matnTekshir = (p: Obj, kalit: "text" | "caption", maks: number) => {
    const m = p[kalit];
    if (kalit === "text" && (typeof m !== "string" || m.length === 0)) throw new ApiXato(400, "Bad Request: message text is empty");
    if (typeof m === "string") {
      if (m.length > maks) throw new ApiXato(400, kalit === "text" ? "Bad Request: message is too long" : "Bad Request: message caption is too long");
      if (p["parse_mode"] === "HTML") { const x = htmlTekshir(m); if (x) throw new ApiXato(400, `Bad Request: ${x}`); }
    }
  };

  const usullar: Record<string, (p: Obj, fayl: Map<string, Buffer>) => unknown> = {
    getMe: () => BOT,
    getUpdates: () => { throw new Error("maxsus"); },
    setWebhook: (p) => {
      const url = satr(p["url"]);
      if (url === "") { webhook = undefined; return true; }
      const secret = p["secret_token"] as string | undefined;
      if (secret !== undefined && !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) throw new ApiXato(400, "Bad Request: secret token contains unallowed characters");
      webhook = { url, ...(secret ? { secret } : {}) };
      return true;
    },
    deleteWebhook: (p) => { webhook = undefined; if (p["drop_pending_updates"]) navbat.length = 0; return true; },
    getWebhookInfo: () => ({ url: webhook?.url ?? "", has_custom_certificate: false, pending_update_count: navbat.length }),
    setMyCommands: () => true,
    sendChatAction: () => true,
    sendMessage: (p) => {
      matnTekshir(p, "text", 4096);
      markupTekshir(p["reply_markup"]);
      return xabarYoz(Number(p["chat_id"]), { text: String(p["text"]), ...(p["reply_markup"] ? { reply_markup: p["reply_markup"] as Obj } : {}), ...(p["parse_mode"] ? { parse_mode: satr(p["parse_mode"]) } : {}) });
    },
    editMessageText: (p) => {
      matnTekshir(p, "text", 4096);
      markupTekshir(p["reply_markup"]);
      const m = chatlar.get(Number(p["chat_id"]))?.find((x) => x.message_id === Number(p["message_id"]));
      if (!m) throw new ApiXato(400, "Bad Request: message to edit not found");
      if (m.text === p["text"] && JSON.stringify(m.reply_markup ?? null) === JSON.stringify(p["reply_markup"] ?? null)) {
        throw new ApiXato(400, "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message");
      }
      m.text = String(p["text"]);
      if (p["reply_markup"]) m.reply_markup = p["reply_markup"] as Obj;
      return m;
    },
    editMessageReplyMarkup: (p) => {
      markupTekshir(p["reply_markup"]);
      const m = chatlar.get(Number(p["chat_id"]))?.find((x) => x.message_id === Number(p["message_id"]));
      if (!m) throw new ApiXato(400, "Bad Request: message to edit not found");
      if (JSON.stringify(m.reply_markup ?? null) === JSON.stringify(p["reply_markup"] ?? null)) throw new ApiXato(400, "Bad Request: message is not modified");
      if (p["reply_markup"]) m.reply_markup = p["reply_markup"] as Obj;
      else delete m.reply_markup;
      return m;
    },
    deleteMessage: (p) => {
      const l = chatlar.get(Number(p["chat_id"])) ?? [];
      const i = l.findIndex((x) => x.message_id === Number(p["message_id"]));
      if (i < 0) throw new ApiXato(400, "Bad Request: message to delete not found");
      l.splice(i, 1);
      return true;
    },
    answerCallbackQuery: (p) => {
      const id = String(p["callback_query_id"]);
      if (callbackJavob.has(id)) throw new ApiXato(400, "Bad Request: query is too old and response timeout expired or query ID is invalid");
      callbackJavob.set(id, p);
      return true;
    },
    sendPhoto: (p, f) => {
      matnTekshir(p, "caption", 1024);
      const ph = mediaOl(f.get("photo") ?? p["photo"], f, "photos", "jpg");
      return xabarYoz(Number(p["chat_id"]), { photo: [{ ...ph, width: 90, height: 90 }], ...(p["caption"] ? { caption: satr(p["caption"]) } : {}) });
    },
    sendDocument: (p, f) => {
      matnTekshir(p, "caption", 1024);
      const d = mediaOl(f.get("document") ?? p["document"], f, "documents", "bin");
      return xabarYoz(Number(p["chat_id"]), { document: { ...d, file_name: "fayl" }, ...(p["caption"] ? { caption: satr(p["caption"]) } : {}) });
    },
    sendMediaGroup: (p, f) => {
      const media = (typeof p["media"] === "string" ? JSON.parse(p["media"]) : p["media"]) as { type: string; media: string; caption?: string }[];
      if (media.length < 2 || media.length > 10) throw new ApiXato(400, "Bad Request: wrong number of messages to send");
      const guruh = randomBytes(6).toString("hex");
      return media.map((m) => {
        const ph = mediaOl(m.media, f, "photos", "jpg");
        return xabarYoz(Number(p["chat_id"]), { photo: [{ ...ph, width: 90, height: 90 }], media_group_id: guruh, ...(m.caption ? { caption: m.caption } : {}) });
      });
    },
    getFile: (p) => {
      const f = fayllar.get(String(p["file_id"]));
      if (!f) throw new ApiXato(400, "Bad Request: invalid file_id");
      if (f.bayt.length > 20 * 1024 * 1024) throw new ApiXato(400, "Bad Request: file is too big");
      return { file_id: p["file_id"], file_unique_id: f.unique, file_size: f.bayt.length, file_path: f.path };
    },
    answerInlineQuery: (p) => {
      const nat = (typeof p["results"] === "string" ? JSON.parse(p["results"]) : p["results"]) as unknown[];
      if (nat.length > 50) throw new ApiXato(400, "Bad Request: RESULTS_TOO_MUCH");
      inlineJavob.set(String(p["inline_query_id"]), p);
      return true;
    },
    getChatMember: (p) => ({ status: Number(p["user_id"]) === BOT.id ? "administrator" : "member", user: { id: p["user_id"], is_bot: false, first_name: "a" } }),
    sendInvoice: (p) => {
      if (p["currency"] === "XTR" && p["provider_token"] !== undefined && p["provider_token"] !== "") throw new ApiXato(400, "Bad Request: provider_token must be empty for Telegram Stars");
      const narxlar = (typeof p["prices"] === "string" ? JSON.parse(p["prices"]) : p["prices"]) as { amount: number }[];
      if (p["currency"] === "XTR" && narxlar.length !== 1) throw new ApiXato(400, "Bad Request: exactly one price must be specified for Telegram Stars");
      return xabarYoz(Number(p["chat_id"]), { invoice: { title: p["title"], currency: p["currency"], total_amount: narxlar.reduce((a, b) => a + b.amount, 0), payload: p["payload"] } });
    },
    answerPreCheckoutQuery: (p) => { preCheckout.set(String(p["pre_checkout_query_id"]), p); return true; },
    refundStarPayment: (p) => { if (!p["telegram_payment_charge_id"]) throw new ApiXato(400, "Bad Request: CHARGE_ID_INVALID"); return true; },
    answerWebAppQuery: (p) => ({ inline_message_id: `soxta-${String(p["web_app_query_id"])}` }),
  };

  async function tanaOqi(req: IncomingMessage): Promise<{ p: Obj; f: Map<string, Buffer> }> {
    const b: Buffer[] = [];
    for await (const x of req) b.push(x as Buffer);
    const buf = Buffer.concat(b);
    const tur = req.headers["content-type"] ?? "";
    if (tur.startsWith("multipart/form-data")) {
      const fd = await new Response(buf, { headers: { "content-type": tur } }).formData();
      const p: Obj = {};
      const f = new Map<string, Buffer>();
      for (const [k, v] of fd.entries()) {
        if (typeof v === "string") { try { p[k] = JSON.parse(v) as unknown; } catch { p[k] = v; } } else f.set(k, Buffer.from(await v.arrayBuffer()));
      }
      return { p, f };
    }
    return { p: buf.length ? (JSON.parse(buf.toString()) as Obj) : {}, f: new Map() };
  }

  const javob = (res: ServerResponse, kod: number, tana: unknown) => { res.writeHead(kod, { "content-type": "application/json" }).end(JSON.stringify(tana)); };

  const srv: Server = createServer((req, res) => {
    void (async () => {
      const u = new URL(req.url ?? "/", "http://x");
      const fm = /^\/file\/bot([^/]+)\/(.+)$/.exec(u.pathname);
      if (fm) {
        const f = fm[1] === o.token ? [...fayllar.values()].find((x) => x.path === fm[2]) : undefined;
        if (!f) { res.writeHead(404).end(); return; }
        res.writeHead(200, { "content-length": String(f.bayt.length) }).end(f.bayt);
        return;
      }
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(u.pathname);
      if (!m || m[1] !== o.token) { javob(res, 401, { ok: false, error_code: 401, description: "Unauthorized" }); return; }
      const method = m[2] ?? "";
      let tana: { p: Obj; f: Map<string, Buffer> };
      try { tana = await tanaOqi(req); } catch (e) { javob(res, 413, { ok: false, error_code: 413, description: e instanceof Error ? e.message : "?" }); return; }
      for (const [k, v] of u.searchParams) tana.p[k] = v;
      chaqiruvlar.push({ method, params: tana.p, vaqt: Date.now() });
      if (method === "getUpdates") {
        if (webhook) { javob(res, 409, { ok: false, error_code: 409, description: "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first" }); return; }
        const offset = Number(tana.p["offset"] ?? 0);
        if (offset) { while (navbat.length && Number(navbat[0]?.["update_id"]) < offset) navbat.shift(); }
        const timeout = Math.min(Number(tana.p["timeout"] ?? 0), 50) * 1000;
        if (navbat.length === 0 && timeout > 0) {
          await new Promise<void>((ok) => { const t = setTimeout(ok, timeout); kutuvchilar.push(() => { clearTimeout(t); ok(); }); req.on("close", () => { clearTimeout(t); ok(); }); });
        }
        const limit = Number(tana.p["limit"] ?? 100);
        javob(res, 200, { ok: true, result: navbat.slice(0, limit) });
        return;
      }
      const f = usullar[method];
      if (!f) { javob(res, 404, { ok: false, error_code: 404, description: "Not Found: method not found" }); return; }
      try {
        javob(res, 200, { ok: true, result: f(tana.p, tana.f) });
      } catch (e) {
        if (e instanceof ApiXato) javob(res, e.kod, { ok: false, error_code: e.kod, description: e.message, ...(e.params ? { parameters: e.params } : {}) });
        else javob(res, 500, { ok: false, error_code: 500, description: String(e) });
      }
    })();
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${String((srv.address() as AddressInfo).port)}`;

  const user = (id: number, ism = "Aziz") => ({ id, is_bot: false, first_name: ism, language_code: "uz" });
  return {
    url,
    BOT,
    chaqiruvlar,
    chatlar,
    bloklagan,
    callbackJavob,
    preCheckout,
    inlineJavob,
    webhookYetkazish,
    webhookHolati: () => webhook,
    navbatda: () => navbat.length,
    /** Foydalanuvchi botga yozadi (shaxsiy chat id = foydalanuvchi id; guruh — manfiy) */
    yozadi: (chatId: number, text: string, kimdan = chatId) => {
      const entities = text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: (text.split(" ")[0] ?? "").length }] : undefined;
      if (!chatlar.has(chatId)) chatlar.set(chatId, []);
      return updateQosh({ message: { message_id: xabarId++, from: user(kimdan), chat: { id: chatId, type: chatId < 0 ? "supergroup" : "private" }, date: Math.floor(Date.now() / 1000), text, ...(entities ? { entities } : {}) } });
    },
    /** Inline tugma bosiladi (bot yuborgan xabar ostida) */
    bosadi: (chatId: number, messageId: number, data: string) => {
      const msg = chatlar.get(chatId)?.find((x) => x.message_id === messageId);
      const id = randomBytes(8).toString("hex");
      updateQosh({ callback_query: { id, from: user(chatId), chat_instance: "1", data, ...(msg ? { message: { ...msg, from: { ...BOT } } } : {}) } });
      return id;
    },
    inline: (kimdan: number, query: string) => { const id = randomBytes(8).toString("hex"); updateQosh({ inline_query: { id, from: user(kimdan), query, offset: "" } }); return id; },
    rasmYuboradi: (chatId: number, bayt: Buffer) => {
      const f = faylSaqla(bayt, "photos", "jpg");
      return updateQosh({ message: { message_id: xabarId++, from: user(chatId), chat: { id: chatId, type: "private" }, date: Math.floor(Date.now() / 1000), photo: [{ ...f, width: 90, height: 90 }] } });
    },
    guruhgaQoshildi: (guruhId: number) => { chatlar.set(guruhId, []); return updateQosh({ my_chat_member: { chat: { id: guruhId, type: "supergroup", title: "Jamoa" }, from: user(1), date: 0, old_chat_member: { status: "left", user: BOT }, new_chat_member: { status: "member", user: BOT } } }); },
    /** To'lov: Telegram pre_checkout_query yuboradi; bot answerPreCheckoutQuery ok:true bilan javob bersa — successful_payment */
    tolaydi: (chatId: number, payload: string, summa: number, valyuta = "XTR") => {
      const id = randomBytes(8).toString("hex");
      updateQosh({ pre_checkout_query: { id, from: user(chatId), currency: valyuta, total_amount: summa, invoice_payload: payload } });
      return id;
    },
    tolovYakunlandi: (chatId: number, payload: string, summa: number) =>
      updateQosh({ message: { message_id: xabarId++, from: user(chatId), chat: { id: chatId, type: "private" }, date: Math.floor(Date.now() / 1000), successful_payment: { currency: "XTR", total_amount: summa, invoice_payload: payload, telegram_payment_charge_id: `stxSOXTA${randomBytes(6).toString("hex")}`, provider_payment_charge_id: "" } } }),
    oxirgi: (chatId: number) => chatlar.get(chatId)?.at(-1),
    yop: () => new Promise<void>((r) => { for (const k of kutuvchilar.splice(0)) k(); srv.closeAllConnections(); srv.close(() => { r(); }); }),
  };
}
