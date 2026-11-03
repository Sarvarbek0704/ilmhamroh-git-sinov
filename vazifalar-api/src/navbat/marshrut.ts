// marshrut.ts — 29-qism B (holat 45, #47): Bull Board — navbatlarni kuzatish (UI + API). 30 C: Express adapteri ilova.ts da `/v1/admin/navbat` ga
// ulanadi — 28 admin roli tekshiruvidan keyin (navbatdagi ish ma'lumoti — foydalanuvchi id, email — maxfiy). Muddat yo'li — navbat.controller.ts.
import type { Router } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import type { Navbatlar } from "./navbat.ts";

export function navbatKuzatuv(navbatlar: Navbatlar, yol: string): Router {
  const s = new ExpressAdapter();
  s.setBasePath(yol);
  createBullBoard({ queues: [new BullMQAdapter(navbatlar.eslatma), new BullMQAdapter(navbatlar.yetkazish), new BullMQAdapter(navbatlar.tizim)], serverAdapter: s });
  return s.getRouter() as Router;
}
