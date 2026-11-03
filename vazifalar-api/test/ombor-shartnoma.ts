// ombor-shartnoma.ts — VazifaOmbori SHARTNOMA testlari: har amalga oshirish (xotira, fayl, 26-qismda postgres) bir xil testdan o'tadi.
// Foydalanish: omborShartnomasi("postgres", async () => new PgOmbori(pool)) — har chaqiruv BO'SH ombor qaytarishi kerak
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import type { RoyxatSorovi, VazifaOmbori } from "../src/vazifalar/ombor.ts";

export function omborShartnomasi(nom: string, yarat: () => Promise<VazifaOmbori>): void {
  describe(`VazifaOmbori shartnomasi: ${nom}`, () => {
    test("yarat: id 1 dan, teglar matndan, versiya 1, tartib oxiriga, sanalar ISO UTC; ol — nusxa", async () => {
      const o = await yarat();
      const v = await o.yarat({ matn: "Non olish #Uy #uy" });
      assert.equal(v.id, 1);
      assert.deepEqual(v.teglar, ["uy"]);
      assert.equal(v.versiya, 1);
      assert.equal(v.bajarildi, false);
      assert.equal(v.tartib, 1);
      assert.equal((await o.yarat({ matn: "ikkinchi" })).tartib, 2);
      assert.match(v.yaratildi, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const olingan = await o.ol(1);
      assert.deepEqual(olingan, v);
      assert.ok(olingan);
      olingan.matn = "buzildi";
      assert.equal((await o.ol(1))?.matn, "Non olish #Uy #uy"); // ombordagi nusxa o'zgarmaydi
      assert.equal(await o.ol(99), undefined);
    });

    test("yangila: versiya +1, shart mos kelmasa konflikt, yo'q id — topilmadi", async () => {
      const o = await yarat();
      await o.yarat({ matn: "a" });
      const n = await o.yangila(1, { bajarildi: true }, { versiya: 1 });
      assert.ok(n.tur === "ok" && n.qiymat.versiya === 2);
      const k = await o.yangila(1, { matn: "b #yangi" }, { versiya: 1 });
      assert.ok(k.tur === "konflikt" && k.joriy.versiya === 2);
      const t = await o.yangila(1, { matn: "b #yangi" });
      assert.ok(t.tur === "ok" && t.qiymat.teglar[0] === "yangi" && t.qiymat.versiya === 3);
      assert.equal((await o.yangila(99, { bajarildi: true })).tur, "topilmadi");
    });

    test("ochir: shart, topilmadi, to'plam versiyasi har yozuvda oshadi", async () => {
      const o = await yarat();
      await o.yarat({ matn: "a" });
      await o.yarat({ matn: "b" });
      const hammasi: RoyxatSorovi = { filtr: {}, saralash: [], limit: 10, sahifa: { tur: "kursor" } };
      const v0 = (await o.royxat(hammasi)).versiya;
      assert.equal((await o.ochir(1, { versiya: 5 })).tur, "konflikt");
      assert.equal((await o.ochir(1)).tur, "ok");
      assert.equal((await o.ochir(1)).tur, "topilmadi");
      const r = await o.royxat(hammasi);
      assert.deepEqual(r.vazifalar.map((v) => v.id), [2]);
      assert.ok(r.versiya > v0);
    });

    test("royxat: filtr (bajarildi, teglar AND, qidiruv), saralash, offset, kursor, jami; soni; teglar", async () => {
      const o = await yarat();
      for (const [m, b] of [["Non #uy", false], ["Hisobot #ish", true], ["Sut #uy #bozor", false], ["Olma #bozor", true]] as const) await o.yarat({ matn: m, bajarildi: b });
      const r = (s: Partial<RoyxatSorovi>) => o.royxat({ filtr: {}, saralash: [], limit: 10, sahifa: { tur: "kursor" }, ...s });
      assert.deepEqual((await r({ filtr: { teglar: ["uy", "bozor"] } })).vazifalar.map((v) => v.id), [3]);
      assert.deepEqual((await r({ filtr: { bajarildi: true, qidiruv: "OLMA" } })).vazifalar.map((v) => v.id), [4]);
      assert.deepEqual((await r({ saralash: [{ maydon: "matn", kamayish: true }] })).vazifalar.map((v) => v.matn), ["Sut #uy #bozor", "Olma #bozor", "Non #uy", "Hisobot #ish"]);
      const p1 = await r({ limit: 3, jami: true });
      assert.equal(p1.jami, 4);
      assert.equal(p1.borKeyingi, true);
      const p2 = await r({ limit: 3, sahifa: { tur: "kursor", keyin: p1.keyingi ?? [] } });
      assert.deepEqual(p2.vazifalar.map((v) => v.id), [4]);
      assert.equal(p2.borKeyingi, false);
      assert.deepEqual((await r({ limit: 2, sahifa: { tur: "offset", offset: 2 } })).vazifalar.map((v) => v.id), [3, 4]);
      assert.equal(await o.soni({ teglar: ["bozor"] }), 2);
      assert.deepEqual((await o.teglar())[0], { teg: "bozor", soni: 2 });
    });

    test("almashtirHammasi: massiv tartibi = tartib (sukut saralash), id saqlanadi/beriladi, eski o'chadi", async () => {
      const o = await yarat();
      await o.yarat({ matn: "eski" });
      const n = await o.almashtirHammasi([{ id: 10, matn: "a #x", bajarildi: true }, { matn: "b", bajarildi: false }, { id: 5, matn: "c", bajarildi: false }]);
      assert.deepEqual(n.vazifalar.map((v) => [v.id, v.tartib]), [[10, 1], [11, 2], [5, 3]]);
      const r = await o.royxat({ filtr: {}, saralash: [], limit: 10, sahifa: { tur: "kursor" } });
      assert.deepEqual(r.vazifalar.map((v) => v.id), [10, 11, 5]); // sudrab tartiblash saqlanadi
      assert.equal(await o.ol(1), undefined);
      assert.equal((await o.yarat({ matn: "d" })).id, 12);
    });
  });
}
