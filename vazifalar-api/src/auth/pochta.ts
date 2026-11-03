// pochta.ts — #12 (holat 12): xat yuborish interfeysi. Haqiqiy SMTP — 29-qism B (holat 13): src/email/smtp-pochtachi.ts (Mailpit bilan sinalgan).
// XotiraPochtachi — testlar (yuborilgan xatlar ro'yxati); LogPochtachi — lokal dev: xat matni log'ga (havolani terminaldan olasiz).
// DIQQAT: xatdagi havola — parolni tiklash kaliti; production'da log'ga yozilmasin (config buni rad etadi).
import type { Log } from "../umumiy/log.ts";

/** 29-qism B (holat 13): shablon — SMTP pochtachisi HTML versiyani Handlebars shablonidan yasaydi; matn — har doim (log, test, matn versiya) */
export type XatShabloni = { nom: "tasdiqlash" | "tiklash"; malumot: Record<string, string> };
export type Xat = { kimga: string; mavzu: string; matn: string; shablon?: XatShabloni };

export interface Pochtachi {
  yubor(xat: Xat): Promise<void>;
}

export class XotiraPochtachi implements Pochtachi {
  readonly yuborilgan: Xat[] = [];
  yubor(xat: Xat): Promise<void> {
    this.yuborilgan.push(xat);
    return Promise.resolve();
  }
  /** Oxirgi xatdagi havolaning # dan keyingi tokeni (testlar uchun) */
  oxirgiToken(kimga?: string): string | undefined {
    const x = this.yuborilgan.filter((y) => kimga === undefined || y.kimga === kimga).at(-1);
    return x === undefined ? undefined : /#token=([A-Za-z0-9_-]{43})/.exec(x.matn)?.[1];
  }
}

export class LogPochtachi implements Pochtachi {
  readonly #log: () => Pick<Log, "info">;
  constructor(log: () => Pick<Log, "info">) {
    this.#log = log;
  }
  yubor(xat: Xat): Promise<void> {
    this.#log().info({ pochta: { kimga: xat.kimga, mavzu: xat.mavzu, matn: xat.matn } }, "pochta (dev): xat yuborilmadi, log'ga yozildi");
    return Promise.resolve();
  }
}
