// pg-ombor.ts — VazifaOmbori ning PostgreSQL (node-postgres, pg.Pool) amalga oshirilishi (26-qism B).
// Sxema — sinov/26/sql (001–013): vazifalar, teglar/vazifa_teglari (trigger matndan to'ldiradi), soft delete (ochirilgan_vaqt),
// versiya (trigger +1), tartib (trigger oxiriga qo'yadi), foydalanuvchilar.vazifalar_versiyasi (ro'yxat versiyasi).
// Auth hali yo'q (28-qism): ombor BITTA egasining vazifalari bilan ishlaydi (egasiId — konstruktorda).
import pg from "pg";
import { hodisaYoz } from "../navbat/outbox.ts";
import { jonliManbaOl } from "../realtime/jonli.ts";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { teglariniOl } from "./vazifa.ts";
import type { Vazifa, VazifaOzgarishi, YangiVazifa } from "./vazifa.ts";
import { kalitlar } from "./royxat-mantiq.ts";
import { KonfliktXatosi } from "../umumiy/xatolar.ts";
import type { AlmashtirishVazifasi, Filtr, KursorQiymati, RoyxatNatija, RoyxatSorovi, SaralashMaydoni, Shart, TegSoni, VazifaOmbori, YozishNatijasi } from "./ombor.ts";

/** API maydoni → SQL ifodasi va kursor qiymatining SQL turi. Oq ro'yxat: foydalanuvchi matni SQL'ga hech qachon tushmaydi (#42) */
const USTUN: Record<SaralashMaydoni, { sql: string; tur: string }> = {
  id: { sql: "v.id", tur: "bigint" },
  tartib: { sql: "v.tartib", tur: "integer" },
  // "C" — kod nuqtasi bo'yicha: xotira ombori (JS < ) va kursor bilan bir xil tartib (en_US.utf8 boshqacha — #17)
  matn: { sql: 'v.matn COLLATE "C"', tur: "text" },
  bajarildi: { sql: "v.bajarildi", tur: "boolean" },
  yaratildi: { sql: "v.yaratilgan_vaqt", tur: "timestamptz" },
  yangilandi: { sql: "v.yangilangan_vaqt", tur: "timestamptz" },
};

function ustun(maydon: string): { sql: string; tur: string } {
  // Object.hasOwn: "constructor", "__proto__" kabi kalitlar prototipdan kelmasin (bosh muharrir qarori, #42)
  if (!Object.hasOwn(USTUN, maydon)) throw new Error(`saralash maydoni oq ro'yxatda yo'q: ${maydon}`);
  return USTUN[maydon as SaralashMaydoni];
}

/** 40P01/40001 bo'lsa butun yozish tranzaksiyasi necha marta urinib ko'riladi (#53) */
const QAYTA_URINISH = 5;

const QATOR = `v.id, v.matn, v.bajarildi, v.tartib, v.versiya, v.yaratilgan_vaqt, v.yangilangan_vaqt`;

type VazifaQatori = { id: number; matn: string; bajarildi: boolean; tartib: number; versiya: number; yaratilgan_vaqt: Date; yangilangan_vaqt: Date };

/** bigint (oid 20) → number, faqat xavfsiz butun son bo'lsa (#41: pg bigint'ni string qaytaradi) */
function bigintSon(s: string): number {
  const n = Number(s);
  if (!Number.isSafeInteger(n)) throw new RangeError(`bigint ${s} Number'ga sig'maydi`);
  return n;
}

/** Pool'ning o'z tur parserlari — global pg.types o'zgarmaydi (boshqa kutubxonalarga ta'sir qilmasin) */
export const TURLAR = new pg.TypeOverrides();
TURLAR.setTypeParser(pg.types.builtins.INT8, bigintSon);

function vazifa(q: VazifaQatori): Vazifa {
  return {
    id: q.id,
    matn: q.matn,
    bajarildi: q.bajarildi,
    // teglar matndan — xotira ombori bilan aynan bir xil qoida va tartib; bazadagi vazifa_teglari — filtr va hisob uchun
    teglar: teglariniOl(q.matn),
    yaratildi: q.yaratilgan_vaqt.toISOString(),
    yangilandi: q.yangilangan_vaqt.toISOString(),
    tartib: q.tartib,
    versiya: q.versiya,
  };
}

/** Parametrlar ro'yxati: qiymat qo'shadi va $n ni qaytaradi — SQL matniga qiymat emas, faqat $n tushadi */
class Parametrlar {
  readonly qiymatlar: unknown[] = [];
  qosh(x: unknown): string {
    this.qiymatlar.push(x);
    return `$${String(this.qiymatlar.length)}`;
  }
}

function shartlar(filtr: Filtr, p: Parametrlar, egasi: number): string[] {
  const s = [`v.egasi_id = ${p.qosh(egasi)}`, "v.ochirilgan_vaqt IS NULL"];
  if (filtr.bajarildi !== undefined) s.push(`v.bajarildi = ${p.qosh(filtr.bajarildi)}`);
  if (filtr.teglar !== undefined && filtr.teglar.length > 0) {
    // hammasi bo'lishi kerak (AND): mos teglar soni = so'ralgan teglar soni. Bazada teg "#" bilan saqlanadi
    const teglar = [...new Set(filtr.teglar)].map((t) => `#${t}`);
    s.push(`(SELECT count(*) FROM vazifa_teglari vt JOIN teglar t ON t.id = vt.teg_id
      WHERE vt.vazifa_id = v.id AND t.nom = ANY(${p.qosh(teglar)}::text[])) = ${p.qosh(teglar.length)}`);
  }
  // LIKE emas: % va _ joker bo'lib qolmasin (#42). strpos — oddiy "ichida bormi"
  if (filtr.qidiruv !== undefined) s.push(`strpos(lower(v.matn), lower(${p.qosh(filtr.qidiruv)})) > 0`);
  if (filtr.yaratildiDan !== undefined) s.push(`v.yaratilgan_vaqt >= ${p.qosh(filtr.yaratildiDan)}::timestamptz`);
  if (filtr.yaratildiGacha !== undefined) s.push(`v.yaratilgan_vaqt < ${p.qosh(filtr.yaratildiGacha)}::timestamptz`);
  return s;
}

/**
 * Keyset (#64): kursordan QAT'IY keyingi qatorlar. Yo'nalishlar aralash bo'lishi mumkin, shuning uchun row value (a, b) > (x, y) emas,
 * yoyilgan shakl: k1 > x1 OR (k1 = x1 AND k2 > x2) OR … (kamayish — "<")
 */
function keyset(k: ReturnType<typeof kalitlar>, keyin: KursorQiymati, p: Parametrlar): string {
  if (keyin.length !== k.length) throw new Error("kursor kalitlari soni saralashga mos emas");
  // Holat 64: yo'nalishlar bir xil bo'lsa — row value (a, b) > ($1, $2). Planner uni INDEKS SHARTI qiladi; yoyilgan OR shakli
  // esa faqat Filter bo'lardi — chuqur sahifada kursor OFFSET kabi qimmat edi (natijalar/reja-53.txt: 400 qator o'qib tashlangan)
  const birXil = k.every((s) => s.kamayish === k[0]?.kamayish);
  if (birXil) {
    const chap = k.map((s) => ustun(s.maydon).sql).join(", ");
    const ong = k.map((s, i) => `${p.qosh(keyin[i])}::${ustun(s.maydon).tur}`).join(", ");
    return `(${chap}) ${k[0]?.kamayish === true ? "<" : ">"} (${ong})`;
  }
  const qism: string[] = [];
  for (let i = 0; i < k.length; i++) {
    const teng = k.slice(0, i).map((s, j) => { const u = ustun(s.maydon); return `${u.sql} = ${p.qosh(keyin[j])}::${u.tur}`; });
    const s = k[i];
    if (s === undefined) continue;
    const u = ustun(s.maydon);
    teng.push(`${u.sql} ${s.kamayish ? "<" : ">"} ${p.qosh(keyin[i])}::${u.tur}`);
    qism.push(`(${teng.join(" AND ")})`);
  }
  return `(${qism.join(" OR ")})`;
}

function kursorQiymati(v: Vazifa, k: ReturnType<typeof kalitlar>): KursorQiymati {
  return k.map((s) => v[s.maydon]);
}

/**
 * Bazadagi qoida (010: o'chirilmaganlar orasida matn registrga befarq noyob — frontend "Bu vazifa ro'yxatda allaqachon bor") buzilsa —
 * kutilgan xato: 409. Xotira ombori takrorga ruxsat beradi — bu farq QADAMLAR'da (26-qism B).
 */
function takrorXatosi(x: unknown): unknown {
  // 23P01 — 014 dagi EXCLUDE cheklovi (holat 53 dan); 23505 — 010 dagi noyob indeks (holat 44–48 sxemasi)
  if (x instanceof pg.DatabaseError && ((x.code === "23P01" && x.constraint === "vazifalar_egasi_id_matn_excl") || (x.code === "23505" && x.constraint === "vazifalar_egasi_id_matn_key"))) {
    return new KonfliktXatosi("Bu vazifa ro'yxatda allaqachon bor", { kod: "takror-matn", sarlavha: "Takror vazifa", cause: x });
  }
  return x;
}

export class PgOmbori implements VazifaOmbori {
  readonly #pool: Pool;
  readonly #egasi: number;

  constructor(pool: Pool, egasiId: number) {
    this.#pool = pool;
    this.#egasi = egasiId;
  }

  /**
   * O'qish (28 #20): bitta tranzaksiyada, boshida set_config('ilova.foydalanuvchi_id') — API vazifalar_api roli bilan ulanganda RLS (105) shu bo'yicha
   * filtrlaydi (o'rnatilmasa — 0 qator). WHERE egasi_id baribir yoziladi (ikki qatlam). Narxi — t20 o'lchovi.
   */
  async #oqi<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    return this.#tranzaksiyada(fn);
  }

  async #bitta<T extends QueryResultRow>(sql: string, qiymatlar: unknown[] = [], c?: PoolClient): Promise<T[]> {
    try {
      if (c !== undefined) return (await c.query<T>(sql, qiymatlar)).rows;
      return await this.#oqi(async (k) => (await k.query<T>(sql, qiymatlar)).rows);
    } catch (x) {
      throw takrorXatosi(x);
    }
  }

  async royxat(sorov: RoyxatSorovi): Promise<RoyxatNatija> {
    return this.#oqi((c) => this.#royxat(c, sorov));
  }

  async #royxat(c: PoolClient, sorov: RoyxatSorovi): Promise<RoyxatNatija> {
    const k = kalitlar(sorov.saralash);
    const p = new Parametrlar();
    const s = shartlar(sorov.filtr, p, this.#egasi);
    const jamiShart = [...s];
    const jamiP = [...p.qiymatlar];
    if (sorov.sahifa.tur === "kursor" && sorov.sahifa.keyin !== undefined) s.push(keyset(k, sorov.sahifa.keyin, p));
    const tartib = k.map((x) => `${ustun(x.maydon).sql} ${x.kamayish ? "DESC" : "ASC"}`).join(", ");
    // limit + 1: bitta ortiqcha qator — "keyingi sahifa bormi" ni alohida COUNT'siz bilish
    let sql = `SELECT ${QATOR} FROM vazifalar v WHERE ${s.join(" AND ")} ORDER BY ${tartib} LIMIT ${p.qosh(sorov.limit + 1)}`;
    if (sorov.sahifa.tur === "offset") sql += ` OFFSET ${p.qosh(sorov.sahifa.offset)}`;
    const qatorlar = (await this.#bitta<VazifaQatori>(sql, p.qiymatlar, c)).map(vazifa);
    const borKeyingi = qatorlar.length > sorov.limit;
    const vazifalar = qatorlar.slice(0, sorov.limit);
    const natija: RoyxatNatija = { vazifalar, borKeyingi, versiya: await this.#versiya(c) };
    const oxirgi = vazifalar.at(-1);
    if (borKeyingi && oxirgi !== undefined) natija.keyingi = kursorQiymati(oxirgi, k);
    if (sorov.jami === true) {
      natija.jami = (await this.#bitta<{ n: number }>(`SELECT count(*)::int AS n FROM vazifalar v WHERE ${jamiShart.join(" AND ")}`, jamiP, c))[0]?.n ?? 0;
    }
    return natija;
  }

  async #versiya(c: PoolClient): Promise<number> {
    const [q] = await this.#bitta<{ versiya: number }>("SELECT vazifalar_versiyasi AS versiya FROM foydalanuvchilar WHERE id = $1", [this.#egasi], c);
    if (q === undefined) throw new Error(`foydalanuvchi ${String(this.#egasi)} bazada yo'q`);
    return q.versiya;
  }

  async soni(filtr: Filtr): Promise<number> {
    const p = new Parametrlar();
    const [q] = await this.#bitta<{ n: number }>(`SELECT count(*)::int AS n FROM vazifalar v WHERE ${shartlar(filtr, p, this.#egasi).join(" AND ")}`, p.qiymatlar);
    return q?.n ?? 0;
  }

  async ol(id: number): Promise<Vazifa | undefined> {
    const [q] = await this.#bitta<VazifaQatori>(`SELECT ${QATOR} FROM vazifalar v WHERE v.id = $1 AND v.egasi_id = $2 AND v.ochirilgan_vaqt IS NULL`, [id, this.#egasi]);
    return q && vazifa(q);
  }

  // Har yozuv #yoz ichida (holat 53): tranzaksiya, AVVAL egasi qatori qulflanadi, keyin vazifalar. Holat 48 da bitta CTE buyrug'i edi —
  // PATCH vazifa → egasi, PUT egasi → vazifalar tartibida qulf olardi: 200 aralash amalda 88–138 ta 40P01 deadlock (natijalar/raqobat-48.txt);
  // parallel yarat() bir xil tartib olardi (50 tadan 8 xil). Ro'yxat versiyasi yozuv bilan bitta tranzaksiyada (birga yoziladi / bekor bo'ladi)
  async yarat(yangi: YangiVazifa): Promise<Vazifa> {
    return this.#yoz(async (c) => {
      // tartib trigger'i (013) max(tartib)+1 ni shu yerda hisoblaydi — egasi qulfi tufayli parallel yarat() lar ketma-ket: tartib takrorlanmaydi
      const [q] = (await c.query<VazifaQatori>(
        `INSERT INTO vazifalar AS v (egasi_id, matn, bajarildi, bajarilgan_vaqt) VALUES ($1, $2, $3, CASE WHEN $3 THEN now() END) RETURNING ${QATOR}`,
        [this.#egasi, yangi.matn, yangi.bajarildi ?? false])).rows;
      if (q === undefined) throw new Error("INSERT qator qaytarmadi");
      await this.#versiyaniOshir(c);
      await this.#hodisa(c, "vazifa.yaratildi", q);
      return vazifa(q);
    });
  }

  async yangila(id: number, ozgarish: VazifaOzgarishi, shart?: Shart): Promise<YozishNatijasi<Vazifa>> {
    return this.#yoz(async (c) => {
      // Optimistik qulf (#52): versiya sharti WHERE'da; 0 qator — yo topilmadi, yo konflikt (#nega aniqlaydi, o'sha tranzaksiyada)
      // yangi_bajarildi: bajarilgan_vaqt AYNAN shu tranzaksiyada qo'yildi (now() — tranzaksiya vaqti) → false → true o'tishi (vazifa.bajarildi hodisasi)
      const [q] = (await c.query<VazifaQatori & { yangi_bajarildi: boolean | null }>(
        `UPDATE vazifalar AS v SET matn = coalesce($3, matn), bajarildi = coalesce($4, bajarildi),
           bajarilgan_vaqt = CASE WHEN coalesce($4, bajarildi) THEN coalesce(bajarilgan_vaqt, now()) END
         WHERE id = $1 AND egasi_id = $2 AND ochirilgan_vaqt IS NULL AND ($5::int IS NULL OR versiya = $5)
         RETURNING ${QATOR}, v.bajarilgan_vaqt = now() AS yangi_bajarildi`,
        [id, this.#egasi, ozgarish.matn ?? null, ozgarish.bajarildi ?? null, shart?.versiya ?? null])).rows;
      if (q === undefined) return this.#nega(c, id);
      await this.#versiyaniOshir(c);
      await this.#hodisa(c, "vazifa.yangilandi", q);
      if (q.yangi_bajarildi === true) await this.#hodisa(c, "vazifa.bajarildi", q);
      return { tur: "ok", qiymat: vazifa(q) };
    });
  }

  async ochir(id: number, shart?: Shart): Promise<YozishNatijasi<null>> {
    return this.#yoz(async (c) => {
      // Yumshoq o'chirish (#38): qator qoladi, ochirilgan_vaqt qo'yiladi
      const r = await c.query<VazifaQatori>(
        `UPDATE vazifalar AS v SET ochirilgan_vaqt = now()
         WHERE id = $1 AND egasi_id = $2 AND ochirilgan_vaqt IS NULL AND ($3::int IS NULL OR versiya = $3)
         RETURNING ${QATOR}`,
        [id, this.#egasi, shart?.versiya ?? null]);
      const q = r.rows[0];
      if (r.rowCount !== 1 || q === undefined) {
        const n = await this.#nega(c, id);
        return n.tur === "konflikt" ? n : { tur: "topilmadi" };
      }
      await this.#versiyaniOshir(c);
      await this.#hodisa(c, "vazifa.ochirildi", q);
      return { tur: "ok", qiymat: null };
    });
  }

  /**
   * 29-qism B (holat 50): transactional outbox — hodisa vazifa yozuvi bilan BIR tranzaksiyada (COMMIT bo'lmasa hodisa ham yo'q).
   * almashtirHammasi (butun to'plam importi) hodisa yozmaydi — ommaviy import; obunachi ro'yxatni qayta oladi.
   */
  async #hodisa(c: PoolClient, tur: string, q: VazifaQatori): Promise<void> {
    await hodisaYoz(c, tur, this.#egasi, { id: q.id, matn: q.matn, bajarildi: q.bajarildi, versiya: q.versiya, manba: jonliManbaOl() });
  }

  async #versiyaniOshir(c: PoolClient): Promise<number> {
    const [f] = (await c.query<{ versiya: number }>(
      "UPDATE foydalanuvchilar SET vazifalar_versiyasi = vazifalar_versiyasi + 1 WHERE id = $1 RETURNING vazifalar_versiyasi AS versiya", [this.#egasi])).rows;
    return f?.versiya ?? 0;
  }

  /**
   * Yozish tranzaksiyasi: (1) egasi qatori FOR UPDATE — hamma yozuv bir xil tartibda qulf oladi (deadlock'ning asosiy sababi yo'qoladi, #53);
   * (2) baribir 40P01/40001 kelsa (masalan, to'g'ridan SQL yozgan boshqa jarayon bilan) — butun tranzaksiya qaytadan, exponential backoff + jitter
   */
  async #yoz<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    for (let urinish = 1; ; urinish++) {
      try {
        return await this.#tranzaksiyada(async (c) => {
          await c.query("SELECT 1 FROM foydalanuvchilar WHERE id = $1 FOR UPDATE", [this.#egasi]);
          return fn(c);
        });
      } catch (x) {
        const kod = x instanceof pg.DatabaseError ? x.code : undefined;
        if ((kod !== "40P01" && kod !== "40001") || urinish >= QAYTA_URINISH) throw x;
        await new Promise((r) => setTimeout(r, Math.random() * 10 * 2 ** urinish));
      }
    }
  }

  /** Yozuv 0 qatorga tegdi — sababi: vazifa yo'q yoki versiya boshqa */
  async #nega(c: PoolClient, id: number): Promise<{ tur: "topilmadi" } | { tur: "konflikt"; joriy: Vazifa }> {
    const [q] = (await c.query<VazifaQatori>(`SELECT ${QATOR} FROM vazifalar v WHERE v.id = $1 AND v.egasi_id = $2 AND v.ochirilgan_vaqt IS NULL`, [id, this.#egasi])).rows;
    const joriy = q && vazifa(q);
    return joriy === undefined ? { tur: "topilmadi" } : { tur: "konflikt", joriy };
  }

  async teglar(): Promise<TegSoni[]> {
    return this.#bitta<TegSoni>(
      `SELECT substr(t.nom, 2) AS teg, count(*)::int AS soni
       FROM teglar t JOIN vazifa_teglari vt ON vt.teg_id = t.id JOIN vazifalar v ON v.id = vt.vazifa_id
       WHERE t.egasi_id = $1 AND v.ochirilgan_vaqt IS NULL
       GROUP BY t.nom ORDER BY soni DESC, substr(t.nom, 2) COLLATE "C"`, [this.#egasi]);
  }

  async almashtirHammasi(yangilar: readonly AlmashtirishVazifasi[]): Promise<{ vazifalar: Vazifa[]; versiya: number }> {
    // #yoz: egasi qatori qulflanadi — bir egasining PUT'lari va boshqa yozuvlari ketma-ket (#51)
    return this.#yoz(async (c) => {
      const berilgan = [...new Set(yangilar.flatMap((y) => (y.id === undefined ? [] : [y.id])))];
      // Berilgan id boshqa egasiniki bo'lsa — uni ishlatib bo'lmaydi (PK), yangi id beriladi
      const ozimniki = new Set((await c.query<{ id: number }>("SELECT id FROM vazifalar WHERE id = ANY($1::bigint[]) AND egasi_id = $2", [berilgan, this.#egasi])).rows.map((r) => r.id));
      // 28 #20: RLS ostida begona qatorlar KO'RINMAYDI — "egasi_id <> $2" bo'sh qaytib, INSERT PK bilan to'qnashardi (500). Faqat "band id'lar" — SECURITY DEFINER (119)
      const { rows: [band] } = await c.query<{ b: string[] }>("SELECT vazifa_idlari_band($1::bigint[])::text[] AS b", [berilgan]);
      const begona = new Set((band?.b ?? []).map(Number).filter((id) => !ozimniki.has(id)));
      const [seq] = (await c.query<{ keyingi: number }>(
        "SELECT (CASE WHEN is_called THEN last_value + 1 ELSE last_value END)::bigint AS keyingi FROM vazifalar_id_seq")).rows;
      let keyingi = Math.max(seq?.keyingi ?? 1, ...berilgan.filter((id) => !begona.has(id)).map((id) => id + 1));
      const ishlatildi = new Set<number>();
      const idlar = yangilar.map((y) => {
        const id = y.id !== undefined && !ishlatildi.has(y.id) && !begona.has(y.id) ? y.id : keyingi++;
        ishlatildi.add(id);
        return id;
      });
      await c.query("UPDATE vazifalar SET ochirilgan_vaqt = now() WHERE egasi_id = $1 AND ochirilgan_vaqt IS NULL AND id <> ALL($2::bigint[])", [this.#egasi, idlar]);
      // #46: ikki to'plam so'rovi (unnest — massivlar parametr bo'lib, qatorlar soni parametrlar chegarasiga bog'liq emas).
      // Holat 44 da har vazifa alohida so'rov edi: 1000 vazifa — 1010 so'rov (natijalar/put-44.txt)
      const tartiblar = yangilar.map((_, i) => i + 1);
      const ustunlar = (tanla: (i: number) => boolean) => {
        const j = yangilar.flatMap((_, i) => (tanla(i) ? [i] : []));
        return [j.map((i) => idlar[i]), j.map((i) => yangilar[i]?.matn), j.map((i) => yangilar[i]?.bajarildi), j.map((i) => tartiblar[i])];
      };
      const bor = (i: number) => ozimniki.has(idlar[i] ?? 0);
      await c.query(
        `UPDATE vazifalar v SET matn = u.matn, bajarildi = u.bajarildi,
           bajarilgan_vaqt = CASE WHEN u.bajarildi THEN coalesce(v.bajarilgan_vaqt, now()) END, tartib = u.tartib, ochirilgan_vaqt = NULL
         FROM unnest($2::bigint[], $3::text[], $4::boolean[], $5::int[]) AS u(id, matn, bajarildi, tartib)
         WHERE v.id = u.id AND v.egasi_id = $1`, [this.#egasi, ...ustunlar(bor)]);
      await c.query(
        `INSERT INTO vazifalar (id, egasi_id, matn, bajarildi, bajarilgan_vaqt, tartib) OVERRIDING SYSTEM VALUE
         SELECT u.id, $1, u.matn, u.bajarildi, CASE WHEN u.bajarildi THEN now() END, u.tartib
         FROM unnest($2::bigint[], $3::text[], $4::boolean[], $5::int[]) AS u(id, matn, bajarildi, tartib)`, [this.#egasi, ...ustunlar((i) => !bor(i))]);
      // Qo'lda berilgan id'lardan keyin sequence orqada qolmasin (keyingi yarat() to'qnashmasin)
      await c.query("SELECT setval('vazifalar_id_seq', greatest((SELECT max(id) FROM vazifalar), (SELECT last_value FROM vazifalar_id_seq)))");
      const [f] = (await c.query<{ versiya: number }>("UPDATE foydalanuvchilar SET vazifalar_versiyasi = vazifalar_versiyasi + 1 WHERE id = $1 RETURNING vazifalar_versiyasi AS versiya", [this.#egasi])).rows;
      const qatorlar = (await c.query<VazifaQatori>(`SELECT ${QATOR} FROM vazifalar v WHERE v.id = ANY($1::bigint[]) ORDER BY v.tartib, v.id`, [idlar])).rows;
      return { vazifalar: qatorlar.map(vazifa), versiya: f?.versiya ?? 0 };
    });
  }

  /**
   * Bitta ulanishda tranzaksiya (#48): BEGIN → fn → COMMIT; xato — ROLLBACK; ulanish doim qaytadi.
   * ROLLBACK ning o'zi yiqilsa (ulanish uzilgan) — release(xato): bu ulanish hovuzga QAYTMAYDI, yopiladi
   * (aks holda keyingi so'rov buzilgan ulanishga tushadi). Bosh muharrir qarori, 26-qism.
   */
  async #tranzaksiyada<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.#pool.connect();
    let buzilgan: Error | undefined;
    // Olingan client'ning "error" hodisasi pool.on("error") ga bormaydi: tinglovchisiz ulanish uzilsa jarayon yiqiladi (t48 topilmasi)
    const xatoTinglovchi = (x: Error): void => { buzilgan = x; };
    c.on("error", xatoTinglovchi);
    try {
      await c.query("BEGIN");
      // RLS (105) va audit (010: vazifa_tarixi.kim_id) — shu tranzaksiya uchun joriy foydalanuvchi. SET LOCAL parametr olmaydi — set_config(…, true)
      await c.query("SELECT set_config('ilova.foydalanuvchi_id', $1, true)", [String(this.#egasi)]);
      const natija = await fn(c);
      await c.query("COMMIT");
      return natija;
    } catch (x) {
      try {
        await c.query("ROLLBACK");
      } catch (r) {
        buzilgan = r instanceof Error ? r : new Error(String(r));
      }
      throw takrorXatosi(x);
    } finally {
      c.off("error", xatoTinglovchi);
      c.release(buzilgan);
    }
  }
}

/** DATABASE_URL dan pool: bigint → number (TURLAR), ilova nomi pg_stat_activity'da ko'rinadi */
export function pgPool(url: string, sozlama: pg.PoolConfig = {}): Pool {
  return new pg.Pool({ connectionString: url, application_name: "vazifalar-api", types: TURLAR, ...sozlama });
}
