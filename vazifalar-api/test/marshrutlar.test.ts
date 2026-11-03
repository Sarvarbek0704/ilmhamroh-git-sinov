// marshrutlar.test.ts — #14 NS-14: DiscoveryService + MetadataScanner + Reflector bilan ilovaning marshrut jadvali (Nest dekoratorlari yozgan
// metama'lumot) o'qiladi va har @All() (405) handler'ining Allow ro'yxati HAQIQIY marshrutlar bilan solishtiriladi. Yangi metod qo'shib Allow'ni
// yangilashni unutsangiz — shu test yiqiladi (Express'da .all(metodYoq("…")) satrlari qo'lda edi, tekshiruv yo'q edi)
import { afterAll, beforeAll, expect, test } from "vitest";
import { Module, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { DiscoveryModule, DiscoveryService, MetadataScanner, NestFactory, Reflector } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { App } from "supertest/types.js";
import { AppModule } from "../src/app.module.ts";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";
import { logYarat } from "../src/umumiy/log.ts";
import { XotiraIdempotentlikOmbori } from "../src/umumiy/idempotentlik.ts";

@Module({ imports: [AppModule.forRoot({ ombor: new XotiraOmbori(), log: logYarat("silent"), idempotentlikOmbori: new XotiraIdempotentlikOmbori(), tz: "Asia/Tashkent" }), DiscoveryModule] })
class SinovModuli {}

let app: INestApplication<App>;
beforeAll(async () => {
  app = await NestFactory.create(SinovModuli, { logger: false });
  await app.init();
});
afterAll(() => app.close());

type Yol = { metodlar: Set<string>; allBor: boolean };
const TARTIB = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];

function marshrutJadvali(): Map<string, Yol> {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const jadval = new Map<string, Yol>();
  for (const w of discovery.getControllers()) {
    const klass = w.metatype as (new (...a: never[]) => object) | null;
    if (klass === null || w.instance === undefined) continue;
    const asos = String(reflector.get<string | string[]>(PATH_METADATA, klass));
    const proto = Object.getPrototypeOf(w.instance) as object;
    for (const nom of scanner.getAllMethodNames(proto)) {
      const handler = (proto as Record<string, unknown>)[nom] as () => unknown;
      const yol = reflector.get<string | undefined>(PATH_METADATA, handler);
      const metod = reflector.get<RequestMethod | undefined>(METHOD_METADATA, handler);
      if (yol === undefined || metod === undefined) continue;
      const toliq = `/${asos}${yol === "/" ? "" : `/${yol}`}`;
      const y = jadval.get(toliq) ?? { metodlar: new Set<string>(), allBor: false };
      if (metod === RequestMethod.ALL) y.allBor = true;
      else {
        y.metodlar.add(RequestMethod[metod]);
        if (metod === RequestMethod.GET) y.metodlar.add("HEAD"); // Express GET marshruti HEAD'ga ham javob beradi
      }
      jadval.set(toliq, y);
    }
  }
  return jadval;
}

test("DiscoveryService: marshrut jadvali (controller + handler metama'lumoti)", () => {
  const jadval = Object.fromEntries([...marshrutJadvali()].map(([k, v]) => [k, `${TARTIB.filter((m) => v.metodlar.has(m)).join(", ")}${v.allBor ? " | 405" : ""}`]));
  expect(jadval).toEqual({
    "/vazifalar": "GET, HEAD, POST, PUT | 405",
    "/vazifalar/toplam": "POST | 405",
    "/vazifalar/:id": "GET, HEAD, PUT, PATCH, DELETE | 405",
    "/vazifalar/oqim": "GET, HEAD",
    "/teglar": "GET, HEAD | 405",
    "/eksportlar": "POST",
    "/eksportlar/:id": "GET, HEAD",
    "/eksportlar/:id/fayl": "GET, HEAD",
    "/health/live": "GET, HEAD",
    "/health/ready": "GET, HEAD",
    "/health/startup": "GET, HEAD", // 31 #27
    // B: servislararo HMAC yo'li — controller doim ro'yxatda, ICHKI_HMAC_SIRI yo'q bo'lsa guard 404 beradi (28: yo'l umuman ulanmasdi)
    "/ichki/tekshiruv": "POST",
  });
});

test("har @All() handler'ining Allow sarlavhasi haqiqiy metodlar bilan bir xil", async () => {
  for (const [yol, y] of marshrutJadvali()) {
    if (!y.allBor) continue;
    const kutilgan = TARTIB.filter((m) => y.metodlar.has(m)).join(", ");
    const yoq = ["DELETE", "POST", "PATCH", "PUT"].find((m) => !y.metodlar.has(m)) ?? "OPTIONS";
    const r = await request(app.getHttpServer())[yoq.toLowerCase() as "delete"](yol.replace(":id", "1")); // sinov ilovasida versiyalash yoqilmagan — yo'l prefikssiz
    expect([yol, r.status, r.headers["allow"]]).toEqual([yol, 405, kutilgan]);
  }
});
