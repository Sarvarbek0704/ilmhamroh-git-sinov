// sxema.pipe.ts — global pipe (#18/#19): Nest 12 `@Body({ schema })`, `@Query({ schema })`, `@Param({ schema })` dekoratorlari parametr metama'lumotiga
// Standard Schema (Zod, Valibot, ArkType…) obyektini qo'yadi; shu pipe uni tekshiradi va xatoni bizning Problem Details turiga aylantiradi:
// body → 422 ValidatsiyaXatosi, query/param → 400 ParametrXatosi (25-qism tekshir() bilan bir xil "joy": body.matn, query.limit).
// Nima uchun o'rnatilgan StandardSchemaValidationPipe emas: u hamma xatoga bitta status beradi (sukut 400) va exceptionFactory parametr turini bilmaydi
import { Injectable } from "@nestjs/common";
import type { ArgumentMetadata, PipeTransform } from "@nestjs/common";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { ParametrXatosi, ValidatsiyaXatosi } from "./xatolar.ts";
// tekshir.ts ichidagi z.config(z.locales.uz()) — sxemada o'z xabarimiz bo'lmagan qoidalar ham o'zbekcha
import "./tekshir.ts";
import type { MaydonXatosi } from "./xatolar.ts";

const JOY: Partial<Record<ArgumentMetadata["type"], string>> = { body: "body", query: "query", param: "params" };

function yolSegmenti(s: PropertyKey | StandardSchemaV1.PathSegment): string {
  return String(typeof s === "object" ? s.key : s);
}

@Injectable()
export class SxemaPipe implements PipeTransform {
  async transform(qiymat: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    const sxema = metadata.schema;
    const joy = JOY[metadata.type];
    // sxemasiz parametr (@Req, @Res, sxemasiz @Body) — o'zgarishsiz o'tadi
    if (sxema === undefined || joy === undefined) return qiymat;
    // @Param("id", { schema }) — bitta qiymat; joy "params.id" bo'lsin
    const ildiz = metadata.data === undefined ? [joy] : [joy, metadata.data];
    const natija = await sxema["~standard"].validate(qiymat);
    if (natija.issues === undefined) return natija.value;
    const xatolar: MaydonXatosi[] = natija.issues.map((i) => ({ joy: [...ildiz, ...(i.path ?? []).map(yolSegmenti)].join("."), xabar: i.message }));
    if (metadata.type === "body") throw new ValidatsiyaXatosi(xatolar);
    throw new ParametrXatosi(xatolar[0]?.xabar ?? "noto'g'ri", xatolar);
  }
}
