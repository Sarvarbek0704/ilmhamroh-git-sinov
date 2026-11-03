// birlik.test.ts — #60 NS-59: Nest unit testlari — Test.createTestingModule, useValue mock'lar (vi.fn), overrideProvider, guard/pipe/interceptor
// alohida. 25–27 testlari asosan HTTP integratsiya (testing trophy); bu yerda — DI orqali bitta klassni izolyatsiyada tekshirish naqshlari
import { describe, expect, test, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { ArgumentMetadata, CallHandler, ExecutionContext } from "@nestjs/common";
import { of, lastValueFrom } from "rxjs";
import { z } from "zod";
import { VazifalarService, HODISA } from "../src/vazifalar/vazifalar.service.ts";
import { WebhookTinglovchi } from "../src/vazifalar/vazifalar.tinglovchi.ts";
import { ClsService } from "nestjs-cls";
import { LOG, OMBOR_FABRIKASI, XABARCHI } from "../src/tokenlar.ts";
import { logYarat } from "../src/umumiy/log.ts";
import { JsonTanaGuard } from "../src/umumiy/json-tana.guard.ts";
import { SxemaPipe } from "../src/umumiy/sxema.pipe.ts";
import { VazifaSarlavhalariInterceptor } from "../src/umumiy/vazifa-sarlavhalari.interceptor.ts";
import { ParametrXatosi, TopilmadiXatosi, ValidatsiyaXatosi } from "../src/umumiy/xatolar.ts";
import { Reflector } from "@nestjs/core";
import type { Vazifa } from "../src/vazifalar/vazifa.ts";
import type { VazifaOmbori } from "../src/vazifalar/ombor.ts";

const v = (o: Partial<Vazifa> = {}): Vazifa => ({ id: 1, matn: "Non", bajarildi: false, teglar: [], yaratildi: "2026-10-28T00:00:00.000Z", yangilandi: "2026-10-28T00:00:00.000Z", tartib: 1, versiya: 1, ...o });

/** VazifaOmbori soxtasi: faqat test kerak qilgan metodlar (qolgani chaqirilsa — xato) */
function soxtaOmbor(ust: Partial<Record<keyof VazifaOmbori, ReturnType<typeof vi.fn>>>): VazifaOmbori {
  // "then" — Nest useValue qiymati Promise emasligini tekshiradi (thenable) — undefined qaytsin
  return new Proxy({} as VazifaOmbori, { get: (_t, k: string) => (k === "then" ? undefined : (ust[k as keyof VazifaOmbori] ?? (() => { throw new Error(`kutilmagan chaqiruv: ombor.${k}`); }))) });
}

async function xizmatModuli(ombor: VazifaOmbori) {
  const m = await Test.createTestingModule({
    providers: [
      VazifalarService,
      // B: ombor fabrikadan (egasi — CLS'dan); unit testda CLS — soxta (egasi 1)
      { provide: OMBOR_FABRIKASI, useValue: () => ombor },
      { provide: ClsService, useValue: { get: () => 1 } },
      { provide: LOG, useValue: logYarat("silent") },
      { provide: EventEmitter2, useValue: new EventEmitter2() },
    ],
  }).compile();
  return { xizmat: m.get(VazifalarService), hodisalar: m.get(EventEmitter2) };
}

describe("VazifalarService (mock ombor, DI)", () => {
  test("yarat: ombor chaqiriladi, 'vazifa.yaratildi' hodisasi chiqadi", async () => {
    const yarat = vi.fn().mockResolvedValue(v({ id: 7 }));
    const { xizmat, hodisalar } = await xizmatModuli(soxtaOmbor({ soni: vi.fn().mockResolvedValue(0), yarat }));
    const tinglovchi = vi.fn();
    hodisalar.on(HODISA.yaratildi, tinglovchi);
    await expect(xizmat.yarat({ matn: "Non" })).resolves.toMatchObject({ id: 7 });
    expect(yarat).toHaveBeenCalledWith({ matn: "Non" });
    expect(tinglovchi).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 1); // B: 2-argument — egasi (SSE faqat o'ziga)
  });

  test("ol: ombor undefined → TopilmadiXatosi (404)", async () => {
    const { xizmat } = await xizmatModuli(soxtaOmbor({ ol: vi.fn().mockResolvedValue(undefined) }));
    await expect(xizmat.ol(5)).rejects.toBeInstanceOf(TopilmadiXatosi);
  });

  test("yangila: faqat false → true o'tishida 'vazifa.bajarildi'; allaqachon true — yo'q", async () => {
    const ol = vi.fn().mockResolvedValueOnce(v({ bajarildi: false })).mockResolvedValueOnce(v({ bajarildi: true }));
    const yangila = vi.fn().mockResolvedValue({ tur: "ok", qiymat: v({ bajarildi: true, versiya: 2 }) });
    const { xizmat, hodisalar } = await xizmatModuli(soxtaOmbor({ ol, yangila }));
    const bajarildi = vi.fn();
    hodisalar.on(HODISA.bajarildi, bajarildi);
    await xizmat.yangila(1, { bajarildi: true });
    await xizmat.yangila(1, { bajarildi: true });
    expect(bajarildi).toHaveBeenCalledTimes(1);
  });
});

test("overrideProvider: WebhookTinglovchi — XABARCHI almashtirildi, hodisa → xabarchi", async () => {
  const xabarchi = vi.fn();
  const m = await Test.createTestingModule({ providers: [WebhookTinglovchi, { provide: XABARCHI, useValue: null }] })
    .overrideProvider(XABARCHI).useValue(xabarchi)
    .compile();
  m.get(WebhookTinglovchi).bajarildi(v({ bajarildi: true }));
  expect(xabarchi).toHaveBeenCalledWith("vazifa.bajarildi", expect.objectContaining({ id: 1 }));
});

/** HTTP'siz ExecutionContext soxtasi (guard/interceptor unit testi uchun) */
function kontekst(req: object, handler: () => unknown, res: object = {}): ExecutionContext {
  return { getHandler: () => handler, getClass: () => Object, switchToHttp: () => ({ getRequest: () => req, getResponse: () => res, getNext: () => undefined }) } as unknown as ExecutionContext;
}

test("JsonTanaGuard: @JsonTana belgisiz handler — o'tadi; belgili + text/plain — 415", () => {
  const guard = new JsonTanaGuard(new Reflector());
  const belgisiz = () => 1;
  const belgili = () => 2;
  Reflect.defineMetadata("vazifalar:json-tana", true, belgili); // @JsonTana() xuddi shu metama'lumotni yozadi
  const req = { is: () => false };
  expect(guard.canActivate(kontekst(req, belgisiz))).toBe(true);
  expect(() => guard.canActivate(kontekst(req, belgili))).toThrow(expect.objectContaining({ holat: 415 }));
});

test("SxemaPipe: body → 422 ValidatsiyaXatosi, param → 400 ParametrXatosi, sxemasiz — o'zgarishsiz", async () => {
  const pipe = new SxemaPipe();
  const sxema = z.strictObject({ matn: z.string().min(1, { error: "bo'sh" }) });
  await expect(pipe.transform({ matn: "" }, { type: "body", schema: sxema } as ArgumentMetadata)).rejects.toSatisfy((x) => x instanceof ValidatsiyaXatosi && x.xatolar?.[0]?.joy === "body.matn");
  await expect(pipe.transform("abc", { type: "param", data: "id", schema: z.string().regex(/^\d+$/) } as ArgumentMetadata)).rejects.toSatisfy((x) => x instanceof ParametrXatosi && x.xatolar?.[0]?.joy === "params.id");
  await expect(pipe.transform({ x: 1 }, { type: "body" } as ArgumentMetadata)).resolves.toEqual({ x: 1 });
});

test("VazifaSarlavhalariInterceptor: javobga ETag va Last-Modified", async () => {
  const sarlavhalar: Record<string, string> = {};
  const res = { set: (k: string, q: string) => { sarlavhalar[k] = q; } };
  const keyingi: CallHandler<Vazifa> = { handle: () => of(v({ versiya: 4 })) };
  await lastValueFrom(new VazifaSarlavhalariInterceptor().intercept(kontekst({}, () => 0, res), keyingi));
  expect(sarlavhalar).toEqual({ ETag: '"4"', "Last-Modified": "Wed, 28 Oct 2026 00:00:00 GMT" });
});
