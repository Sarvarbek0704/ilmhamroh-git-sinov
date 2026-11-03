// vazifalar.tinglovchi.ts — #49 NS-48: domen hodisalari tinglovchisi. Vazifa bajarilganda webhook (25-qism #49 xulqi) — endi xizmat
// webhook'ni bilmaydi: VazifalarService "vazifa.bajarildi" chiqaradi, shu klass tinglaydi. 29-qismda bot/email tinglovchilari shu naqshda
import { Inject, Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { XABARCHI } from "../tokenlar.ts";
import type { Xabarchi } from "../umumiy/webhook.ts";
import { HODISA } from "./vazifalar.service.ts";
import type { Vazifa } from "./vazifa.ts";

@Injectable()
export class WebhookTinglovchi {
  constructor(@Inject(XABARCHI) private readonly xabarchi: Xabarchi | null) {}

  // sinxron tinglovchi: emit() shu so'rov ichida chaqiradi (CLS konteksti — sorovId logda); xabarchi o'zi fire-and-forget (fetch kutilmaydi)
  @OnEvent(HODISA.bajarildi)
  bajarildi(v: Vazifa): void {
    this.xabarchi?.("vazifa.bajarildi", v);
  }
}
