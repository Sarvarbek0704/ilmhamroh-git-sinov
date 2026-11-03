// tekshir.ts — chegarada tekshiruv (trust boundary): tashqaridan kelgan har qiymat Zod sxemasidan o'tadi.
// tekshir() — bitta qiymat (typed natija). 30-qism: HTTP kirishi — SxemaPipe (Nest @Body/@Query/@Param({ schema })); Express middleware'i tekshirib() olib tashlandi (holat 65)
import { z } from "zod";
import { ParametrXatosi, ValidatsiyaXatosi } from "./xatolar.ts";
import type { MaydonXatosi } from "./xatolar.ts";

// Zod 4 da o'zbekcha lokal bor (z.locales.uz) — sxemada o'z xabarimiz bo'lmasa shu ishlatiladi
z.config(z.locales.uz());

export type Joy = "body" | "query" | "params";

function xatolarga(joy: Joy, xato: z.ZodError): MaydonXatosi[] {
  return xato.issues.map((i) => ({ joy: [joy, ...i.path.map(String)].join("."), xabar: i.message }));
}

/** body → 422 (tana mazmuni), query/params → 400 (manzil noto'g'ri) */
export function tekshir<S extends z.ZodType>(sxema: S, qiymat: unknown, joy: Joy): z.output<S> {
  const n = sxema.safeParse(qiymat);
  if (n.success) return n.data;
  const xatolar = xatolarga(joy, n.error);
  if (joy === "body") throw new ValidatsiyaXatosi(xatolar);
  throw new ParametrXatosi(xatolar[0]?.xabar ?? "noto'g'ri", xatolar);
}
