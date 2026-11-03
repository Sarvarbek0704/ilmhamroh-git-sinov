// bot.ts — `vazifalar` eslatma boti (grammY): hisobni ulash (deep link), /vazifalar ro'yxati + inline "Bajarildi" tugmalari, /yangi — ko'p qadamli dialog
// (conversations plugin), /bekor, xatolarni ushlash; markaz uchun Telegram yuboruvchisi (403 → eskirgan, 429 → qayta) (B-153…B-159).
// Lokal: `apiRoot` — soxta Bot API serveri (test/soxta/telegram.ts). Haqiqiy token va Telegram serveri bilan SINALMAGAN.
// 29-qism B (holat 22): `toxta()` — graceful shutdown (SIGTERM): polling to'xtaydi, ishlanayotgan update'lar tugashi kutiladi (#25).
import { Bot, GrammyError, HttpError, InlineKeyboard, type Context, type Api } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { conversations, createConversation, type Conversation, type ConversationData, type ConversationFlavor, type ConversationStorage } from "@grammyjs/conversations";
import { autoRetry } from "@grammyjs/auto-retry";
import type { Yuboruvchi } from "../bildirishnoma/markaz.ts";

export type BotVazifa = { id: number; matn: string; bajarildi: boolean; muddat: Date | null };
export interface VazifaManbai {
  /** Deep link tokeni (bir martalik, qisqa muddatli) → foydalanuvchi id; ishlatilgach o'chadi */
  tokenniIshlat(token: string): Promise<number | undefined>;
  ulash(foydalanuvchiId: number, chatId: number): Promise<void>;
  kim(chatId: number): Promise<number | undefined>;
  royxat(foydalanuvchiId: number): Promise<BotVazifa[]>;
  bajar(foydalanuvchiId: number, vazifaId: number): Promise<boolean>;
  yarat(foydalanuvchiId: number, matn: string, muddat: Date | null): Promise<{ id: number }>;
}

export type BotCtx = ConversationFlavor<Context>;
type IchkiCtx = Context;

/** Telegram HTML parse_mode uchun: faqat `&`, `<`, `>` (hujjat talabi). */
export const html = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** callback_data — 64 BAYT gacha (belgi emas). Shuning uchun matn emas, qisqa kod + id: "b:12345". */
export const CB = { bajar: (id: number) => `b:${String(id)}`, sahifa: (n: number) => `s:${String(n)}` } as const;
const SAHIFA = 5;

const sanaUz = (d: Date) => new Intl.DateTimeFormat("uz-Latn-UZ", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);

export function royxatXabari(v: BotVazifa[], sahifa = 0): { matn: string; klaviatura: InlineKeyboard } {
  const faol = v.filter((x) => !x.bajarildi);
  const k = new InlineKeyboard();
  if (faol.length === 0) return { matn: "Faol vazifa yo'q. Yangi: /yangi", klaviatura: k };
  const qism = faol.slice(sahifa * SAHIFA, sahifa * SAHIFA + SAHIFA);
  const qatorlar = qism.map((x, i) => `${String(sahifa * SAHIFA + i + 1)}. ${html(x.matn)}${x.muddat ? ` — <i>${sanaUz(x.muddat)}</i>` : ""}`);
  for (const x of qism) k.text(`Bajarildi: ${x.matn.length > 30 ? `${x.matn.slice(0, 29)}…` : x.matn}`, CB.bajar(x.id)).row();
  if (sahifa > 0) k.text("< Oldingi", CB.sahifa(sahifa - 1));
  if ((sahifa + 1) * SAHIFA < faol.length) k.text("Keyingi >", CB.sahifa(sahifa + 1));
  return { matn: `<b>Faol vazifalar (${String(faol.length)})</b>\n${qatorlar.join("\n")}`, klaviatura: k };
}

/** "28.10 18:00" | "ertaga" | "yo'q" → Date | null; noto'g'ri → undefined. Toshkent vaqti (UTC+5, yozgi vaqt yo'q). */
export function muddatTahlil(s: string, hozir = new Date()): Date | null | undefined {
  const t = s.trim().toLowerCase();
  if (["yo'q", "yoq", "-", "kerak emas"].includes(t)) return null;
  const toshkentKun = new Date(hozir.getTime() + 5 * 3600_000);
  if (t === "bugun" || t === "ertaga") {
    const d = new Date(Date.UTC(toshkentKun.getUTCFullYear(), toshkentKun.getUTCMonth(), toshkentKun.getUTCDate() + (t === "ertaga" ? 1 : 0), 18 - 5));
    return d;
  }
  const m = /^(\d{1,2})\.(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(t);
  if (!m) return undefined;
  const [, kun, oy, soat = "9", daq = "00"] = m;
  const d = new Date(Date.UTC(toshkentKun.getUTCFullYear(), Number(oy) - 1, Number(kun), Number(soat) - 5, Number(daq)));
  if (d.getUTCMonth() !== Number(oy) - 1 || Number(soat) > 23 || Number(daq) > 59) return undefined;
  if (d.getTime() < hozir.getTime()) d.setUTCFullYear(d.getUTCFullYear() + 1); // o'tgan sana — keyingi yil
  return d;
}

const FAOL = new WeakMap<Bot<BotCtx>, { soni: number; kutuvchilar: (() => void)[] }>();

/**
 * Graceful shutdown (#25): `bot.stop()` — yangi getUpdates yo'q, oxirgi offset tasdiqlanadi (qayta ishga tushganda o'sha update'lar takrorlanmaydi);
 * keyin hozir ishlanayotgan update'lar tugashini `kutishMs` gacha kutadi. A bosqichida topilgan: @grammyjs/runner `stop()` ishlov tugashini
 * kutmadi — shuning uchun hisob o'zimizda. Natija: kutildi=false bo'lsa — jarayon baribir chiqadi (qolgan update'lar Telegram'dan qayta kelmaydi — yo'qoladi).
 */
export async function toxta(bot: Bot<BotCtx>, kutishMs = 10_000): Promise<{ kutildi: boolean; qolgan: number }> {
  const h = FAOL.get(bot);
  if (bot.isRunning()) await bot.stop();
  if (h === undefined || h.soni === 0) return { kutildi: true, qolgan: 0 };
  const kutildi = await new Promise<boolean>((tugadi) => {
    const t = setTimeout(() => { tugadi(false); }, kutishMs);
    h.kutuvchilar.push(() => { clearTimeout(t); tugadi(true); });
  });
  return { kutildi, qolgan: h.soni };
}

export function vazifaBot(token: string, manba: VazifaManbai, o: { apiRoot?: string; botInfo?: UserFromGetMe; dialogTimeoutMs?: number; storage?: ConversationStorage<BotCtx, ConversationData>; log?: (x: unknown) => void } = {}): Bot<BotCtx> {
  const bot = new Bot<BotCtx>(token, { ...(o.apiRoot ? { client: { apiRoot: o.apiRoot } } : {}), ...(o.botInfo ? { botInfo: o.botInfo } : {}) });
  // 429 (retry_after) va 5xx — avtomatik kutib takrorlash; 60 s dan uzoq kutish talab qilinsa — xato qaytariladi
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  // Ishlanayotgan update'lar hisobi — toxta() ularning tugashini kutadi (birinchi middleware: hamma update shu yerdan o'tadi)
  const h = { soni: 0, kutuvchilar: [] as (() => void)[] };
  FAOL.set(bot, h);
  bot.use(async (_ctx, next) => {
    h.soni++;
    try {
      await next();
    } finally {
      h.soni--;
      if (h.soni === 0) for (const f of h.kutuvchilar.splice(0)) f();
    }
  });

  bot.use(conversations<BotCtx, IchkiCtx>(o.storage ? { storage: o.storage } : {}));

  async function yangi(conversation: Conversation<BotCtx>, ctx: IchkiCtx) {
    const fId = await conversation.external(() => manba.kim(ctx.chat?.id ?? 0));
    if (fId === undefined) { await ctx.reply("Avval hisobingizni ulang: ilovadagi \"Telegram'ni ulash\" tugmasi."); return; }
    await ctx.reply("Vazifa matnini yozing (100 belgigacha). Bekor qilish: /bekor");
    const kutish = { maxMilliseconds: o.dialogTimeoutMs ?? 10 * 60_000 };
    let matn = "";
    for (;;) {
      const m = await conversation.waitFor("message:text", { ...kutish, otherwise: (c) => c.reply("Iltimos, matn yuboring.") });
      matn = m.message.text.trim();
      if (matn === "/bekor") { await m.reply("Bekor qilindi."); return; }
      if (matn.length >= 1 && matn.length <= 100 && !matn.startsWith("/")) break;
      await m.reply(`Matn 1–100 belgi bo'lsin (hozir ${String(matn.length)}).`);
    }
    await ctx.reply("Muddat? Masalan: <code>28.10 18:00</code>, <code>ertaga</code> yoki <code>yo'q</code>", { parse_mode: "HTML" });
    let muddat: Date | null | undefined;
    for (;;) {
      const m = await conversation.waitFor("message:text", kutish);
      if (m.message.text.trim() === "/bekor") { await m.reply("Bekor qilindi."); return; }
      const hozir = new Date(await conversation.now()); // replay'da bir xil qiymat (deterministik)
      muddat = muddatTahlil(m.message.text, hozir);
      if (muddat !== undefined) break;
      await m.reply("Tushunmadim. Format: KK.OO SS:DD, masalan 28.10 18:00");
    }
    const yaratilgan = await conversation.external(() => manba.yarat(fId, matn, muddat ?? null));
    await ctx.reply(`Qo'shildi: <b>${html(matn)}</b>${muddat ? ` — ${sanaUz(muddat)}` : ""} (#${String(yaratilgan.id)})`, { parse_mode: "HTML" });
  }
  bot.use(createConversation<BotCtx, IchkiCtx>(yangi, "yangi"));

  bot.command("start", async (ctx) => {
    const t = ctx.match.trim();
    if (t === "") {
      await ctx.reply("Salom! Bu — vazifalar eslatma boti.\nHisobni ulash uchun ilovadagi tugmani bosing, keyin: /vazifalar, /yangi");
      return;
    }
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) { await ctx.reply("Havola noto'g'ri."); return; }
    const fId = await manba.tokenniIshlat(t);
    if (fId === undefined) { await ctx.reply("Havola eskirgan yoki ishlatilgan. Ilovadan yangisini oling."); return; }
    await manba.ulash(fId, ctx.chat.id);
    await ctx.reply("Hisob ulandi. Muddatlar haqida shu yerga yozaman. /vazifalar — ro'yxat");
  });

  bot.command("vazifalar", async (ctx) => {
    const fId = await manba.kim(ctx.chat.id);
    if (fId === undefined) { await ctx.reply("Hisob ulanmagan. /start"); return; }
    const { matn, klaviatura } = royxatXabari(await manba.royxat(fId));
    await ctx.reply(matn, { parse_mode: "HTML", reply_markup: klaviatura });
  });

  bot.command("yangi", async (ctx) => { await ctx.conversation.enter("yangi"); });
  bot.command("bekor", async (ctx) => { await ctx.conversation.exitAll(); await ctx.reply("Hech narsa davom etmayapti."); });

  bot.callbackQuery(/^b:(\d{1,18})$/, async (ctx) => {
    const fId = await manba.kim(ctx.chat?.id ?? 0);
    const id = Number(ctx.match[1]);
    if (fId === undefined) { await ctx.answerCallbackQuery({ text: "Hisob ulanmagan", show_alert: true }); return; }
    const ok = await manba.bajar(fId, id); // egalik manba ichida tekshiriladi (IDOR — callback_data mijozdan keladi!)
    await ctx.answerCallbackQuery({ text: ok ? "Bajarildi" : "Vazifa topilmadi" });
    const { matn, klaviatura } = royxatXabari(await manba.royxat(fId));
    await ctx.editMessageText(matn, { parse_mode: "HTML", reply_markup: klaviatura }).catch((e: unknown) => {
      if (!(e instanceof GrammyError && e.description.includes("message is not modified"))) throw e;
    });
  });
  bot.callbackQuery(/^s:(\d{1,3})$/, async (ctx) => {
    const fId = await manba.kim(ctx.chat?.id ?? 0);
    await ctx.answerCallbackQuery();
    if (fId === undefined) return;
    const { matn, klaviatura } = royxatXabari(await manba.royxat(fId), Number(ctx.match[1]));
    await ctx.editMessageText(matn, { parse_mode: "HTML", reply_markup: klaviatura });
  });
  // Eski/noma'lum tugma — baribir javob beramiz, aks holda mijozda "soat" aylanib turadi
  bot.on("callback_query:data", (ctx) => ctx.answerCallbackQuery({ text: "Eskirgan tugma" }));
  bot.on("message:text", (ctx) => ctx.reply("Buyruqlar: /vazifalar, /yangi, /bekor"));

  bot.catch((err) => {
    const e = err.error;
    const tur = e instanceof GrammyError ? `GrammyError ${String(e.error_code)} ${e.description}` : e instanceof HttpError ? `HttpError ${String(e.error)}` : String(e);
    (o.log ?? console.error)({ update_id: err.ctx.update.update_id, xato: tur });
  });
  return bot;
}

/** Bildirishnoma markazi uchun Telegram kanali: HTML xabar, 403 → eskirgan (bot bloklangan/chat yo'q), 429/5xx/tarmoq → qayta. */
export function telegramYuboruvchi(api: Api): Yuboruvchi {
  return async (q, x) => {
    if (!q.chatId) return { holat: "xato", sabab: "chat ulanmagan" };
    try {
      await api.sendMessage(Number(q.chatId), `<b>${html(x.sarlavha)}</b>\n${html(x.matn)}`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      return { holat: "yuborildi" };
    } catch (e) {
      if (e instanceof GrammyError) {
        if (e.error_code === 403 || (e.error_code === 400 && e.description.includes("chat not found"))) return { holat: "eskirgan" };
        if (e.error_code === 429 || e.error_code >= 500) return { holat: "qayta", sabab: e.description };
        return { holat: "xato", sabab: e.description };
      }
      if (e instanceof HttpError) return { holat: "qayta", sabab: String(e.error) };
      throw e;
    }
  };
}
