import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import { z } from "zod";
import { ishgaTushir, jsonYubor } from "./yordamchi.ts";
import { EksportSxemasi, OzgarishSxemasi, RoyxatQuerySxemasi } from "../src/vazifalar/sxema.ts";
import { tekshir } from "../src/umumiy/tekshir.ts";
import { IlovaXatosi, ParametrXatosi, ValidatsiyaXatosi } from "../src/umumiy/xatolar.ts";

let asos = "";
let yop: () => Promise<boolean>;
beforeAll(async () => ({ asos, yop } = await ishgaTushir()));
afterAll(() => yop());

test("query sxemasi: transform (teg, sort, fields), sukut limit, noma'lum parametr", () => {
  const q = RoyxatQuerySxemasi.parse({ teg: ["#UY", "uy", "ish"], sort: "-yaratildi,matn", fields: "matn" });
  assert.deepEqual(q.teg, ["uy", "ish"]);
  assert.deepEqual(q.sort, [{ maydon: "yaratildi", kamayish: true }, { maydon: "matn", kamayish: false }]);
  assert.deepEqual(q.fields, ["id", "matn"]);
  assert.equal(q.limit, 20);
  const x = RoyxatQuerySxemasi.safeParse({ sahifa: "2" });
  assert.equal(x.error?.issues[0]?.message, "noma'lum parametr: sahifa");
  const y = RoyxatQuerySxemasi.safeParse({ offset: "0", cursor: "abc" });
  assert.equal(y.error?.issues[0]?.message, "offset va cursor birga berilmaydi");
});

test("tekshir(): body → ValidatsiyaXatosi (422), query → ParametrXatosi (400); ikkalasi IlovaXatosi", () => {
  assert.throws(() => tekshir(OzgarishSxemasi, {}, "body"), (x: unknown) => x instanceof ValidatsiyaXatosi && x instanceof IlovaXatosi && x.holat === 422 && x.name === "ValidatsiyaXatosi");
  assert.throws(() => tekshir(RoyxatQuerySxemasi, { limit: "0" }, "query"), (x: unknown) => x instanceof ParametrXatosi && x.xatolar?.[0]?.joy === "query.limit");
});

test("Zod o'zbekcha lokal: o'z xabari yo'q qoidada ham o'zbekcha", () => {
  const n = z.object({ a: z.number() }).safeParse({ a: "1" });
  assert.match(n.error?.issues[0]?.message ?? "", /Noto‘g‘ri kirish/);
});

test("eksport discriminatedUnion: csv (; bilan), json; noma'lum format — 422", async () => {
  await fetch(`${asos}/v1/vazifalar`, jsonYubor("POST", { matn: "Non; sut" }));
  assert.deepEqual(EksportSxemasi.parse(undefined), { format: "csv", ajratgich: "," });
  const yomon = await fetch(`${asos}/v1/eksportlar`, jsonYubor("POST", { format: "xlsx" }));
  assert.equal(yomon.status, 422);
  assert.equal(((await fetch(`${asos}/v1/eksportlar`, jsonYubor("POST", { format: "json", ajratgich: ";" }))).status), 422); // json'da ajratgich yo'q
  for (const [tana, kutilgan] of [[{ format: "csv", ajratgich: ";" }, 'id;matn;bajarildi'], [{ format: "json" }, '[{"id":1,']] as const) {
    const r = await fetch(`${asos}/v1/eksportlar`, jsonYubor("POST", tana));
    const joy = String(r.headers.get("location"));
    let h = { holat: "", fayl: "" };
    for (let i = 0; i < 50 && h.holat !== "tayyor"; i++) {
      h = (await (await fetch(asos + joy)).json()) as typeof h;
      if (h.holat !== "tayyor") await new Promise((ok) => setTimeout(ok, 10));
    }
    const matn = await (await fetch(asos + h.fayl)).text();
    assert.ok(matn.startsWith(kutilgan), matn.slice(0, 40));
    if (tana.format === "csv") assert.match(matn, /"Non; sut"/);
    else assert.equal((JSON.parse(matn) as unknown[]).length, 1);
  }
});
