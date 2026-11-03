// halokat.ts — test qolipi (alohida jarayon): yarat() ichida "unutilgan" Promise rad etiladi (fire-and-forget xatosi)
import { ishgaTushir } from "../../src/ishga-tushir.ts";
import { jarayonniBoshqar } from "../../src/jarayon.ts";
import { XotiraOmbori } from "../../src/vazifalar/xotira-ombor.ts";
import type { Vazifa, YangiVazifa } from "../../src/vazifalar/vazifa.ts";

class XatoliOmbor extends XotiraOmbori {
  override async yarat(y: YangiVazifa): Promise<Vazifa> {
    void Promise.reject(new Error("bildirishnoma yuborilmadi")); // hech kim ushlamaydi
    await new Promise((r) => setTimeout(r, 200));
    return super.yarat(y);
  }
}
const { server, manzil } = await ishgaTushir({ port: 0, bogliqliklar: { ombor: new XatoliOmbor() } });
jarayonniBoshqar(server, { info: (x) => { console.log(x); }, fatal: (x, xato) => { console.error(x, xato instanceof Error ? xato.message : xato); } }, { halokatKutishMs: 1000 });
console.log(manzil);
