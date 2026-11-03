// sxema.ts — Zod sxemalaridan JSON Schema (z.toJSONSchema): hujjat, OpenAPI va frontend uchun yagona manba.
// npm run sxema → docs/sxemalar.json. io: "input" — mijoz YUBORADIGAN shakl (transform'dan oldin)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EksportSxemasi, OzgarishSxemasi, RoyxatQuerySxemasi, ToliqVazifaSxemasi, ToplamSxemasi, YangiVazifaSxemasi } from "../src/vazifalar/sxema.ts";

const sxemalar = {
  YangiVazifa: YangiVazifaSxemasi,
  ToliqVazifa: ToliqVazifaSxemasi,
  VazifaOzgarishi: OzgarishSxemasi,
  Toplam: ToplamSxemasi,
  Eksport: EksportSxemasi,
  RoyxatQuery: RoyxatQuerySxemasi,
};
// transform/refine JSON Schema'da ifodalanmaydi — "any" o'rniga xato bermasin (unrepresentable: "any")
const natija = Object.fromEntries(Object.entries(sxemalar).map(([nom, s]) => [nom, z.toJSONSchema(s, { io: "input", unrepresentable: "any" })]));
const papka = join(import.meta.dirname, "..", "docs");
mkdirSync(papka, { recursive: true });
writeFileSync(join(papka, "sxemalar.json"), JSON.stringify(natija, null, 2) + "\n");
console.log(`docs/sxemalar.json: ${Object.keys(natija).join(", ")}`);
