// hodisa.test.ts — holat 51: domen hodisalari → SSE oqimi (#49/#53), salomatlik endpoint'lari (#51), rejalashtirilgan tozalash (#48)
import { afterAll, beforeAll, expect, test } from "vitest";
import { SchedulerRegistry } from "@nestjs/schedule";
import { ishgaTushir as ishga } from "../src/ishga-tushir.ts";
import type { Ishlayotgan } from "../src/ishga-tushir.ts";
import { yop } from "../src/yopish.ts";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";
import { EksportService } from "../src/eksport/eksport.service.ts";
import { jsonYubor } from "./yordamchi.ts";

class BuzuqOmbor extends XotiraOmbori {
  override soni(): Promise<number> {
    return Promise.reject(new Error("ulanish uzildi"));
  }
}

let i: Ishlayotgan;
let buzuq: Ishlayotgan;
beforeAll(async () => {
  i = await ishga({ port: 0, bogliqliklar: { ombor: new XotiraOmbori() } });
  buzuq = await ishga({ port: 0, bogliqliklar: { ombor: new BuzuqOmbor() } });
});
afterAll(async () => {
  for (const x of [i, buzuq]) {
    await yop(x.server, 1000);
    await x.app.close(); // @Interval taymerlari to'xtasin
  }
});

test("SSE /v1/vazifalar/oqim: yaratish va bajarish hodisalari oqimda (text/event-stream)", async () => {
  const boshqaruv = new AbortController();
  const r = await fetch(`${i.manzil}/v1/vazifalar/oqim`, { signal: boshqaruv.signal });
  expect(r.headers.get("content-type")).toMatch(/text\/event-stream/);
  const oquvchi = r.body?.getReader();
  if (oquvchi === undefined) throw new Error("tana yo'q");
  const yangi = (await (await fetch(`${i.manzil}/v1/vazifalar`, jsonYubor("POST", { matn: "SSE sinovi #oqim" }))).json()) as { id: number };
  await fetch(`${i.manzil}/v1/vazifalar/${String(yangi.id)}`, jsonYubor("PATCH", { bajarildi: true }));
  let matn = "";
  const dekoder = new TextDecoder();
  while (!matn.includes("event: vazifa.bajarildi")) {
    const { value, done } = await oquvchi.read();
    if (done) break;
    matn += dekoder.decode(value);
  }
  boshqaruv.abort();
  expect(matn).toMatch(/event: vazifa\.yaratildi\nid: \d+\ndata: \{"id":1,"matn":"SSE sinovi #oqim"/);
  expect(matn).toContain("event: vazifa.yangilandi");
  expect(matn).toContain("event: vazifa.bajarildi");
});

test("salomatlik: /health/live va /health/ready — 200; ombor javob bermasa ready 503 (Problem Details + tekshiruvlar), live baribir 200", async () => {
  const live = await fetch(`${i.manzil}/health/live`);
  expect([live.status, await live.json()]).toEqual([200, { status: "ok", info: {}, error: {}, details: {} }]);
  const ready = (await (await fetch(`${i.manzil}/health/ready`)).json()) as { status: string; info: { ombor: { status: string } } };
  expect(ready.status).toBe("ok");
  expect(ready.info.ombor.status).toBe("up");
  const yomon = await fetch(`${buzuq.manzil}/health/ready`);
  expect(yomon.status).toBe(503);
  expect(yomon.headers.get("content-type")).toMatch(/problem\+json/);
  const p = (await yomon.json()) as { status: number; tekshiruvlar: { error: { ombor: { status: string; xato: string } } } };
  expect(p.tekshiruvlar.error.ombor).toEqual({ status: "down", xato: "ulanish uzildi" });
  expect((await fetch(`${buzuq.manzil}/health/live`)).status).toBe(200);
});

test("@Interval: eksport-tozalash ro'yxatda; muddati o'tgan ish tozalanadi va 404", async () => {
  expect(i.app.get(SchedulerRegistry).getIntervals()).toContain("eksport-tozalash");
  const eksport = i.app.get(EksportService);
  const r = await fetch(`${i.manzil}/v1/eksportlar`, { method: "POST" });
  const joy = String(r.headers.get("location"));
  expect((await fetch(i.manzil + joy)).status).toBe(200);
  const asl = eksport.soat;
  eksport.soat = () => asl() + 2 * 60 * 60 * 1000; // 2 soat o'tdi (natija 1 soat saqlanadi)
  expect((await fetch(i.manzil + joy)).status).toBe(404);
  expect(eksport.tozala()).toBe(1);
  eksport.soat = asl;
});
