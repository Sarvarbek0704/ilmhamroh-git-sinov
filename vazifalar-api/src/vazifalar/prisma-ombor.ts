// prisma-ombor.ts — VazifaOmbori ning Prisma 7 (prisma-client generatori + @prisma/adapter-pg) amalga oshirilishi (27-qism O bosqich).
// PgOmbori (26) bilan BIR XIL shartnoma testlaridan o'tadi (test/prisma-ombor.test.ts). Farqlari va sabablari:
//   - Oddiy CRUD, filtr, saralash, sahifalash — Prisma Client API'si (tur xavfsiz, SQL yozilmaydi).
//   - Prisma ifodalay olmaydigan joylar — raw SQL ($queryRaw tagged template — parametrlar baribir $n): egasi qatori FOR UPDATE (qulf, #53),
//     `matn COLLATE "C"` saralash (xotira ombori va kursor bilan bir xil tartib), PUT ning unnest bilan ommaviy yozuvi (#46), teglar statistikasi.
//   - bigint: Prisma BigInt'ni JS `bigint` qilib qaytaradi (pg — string) — API'da Number (xavfsiz butun son tekshiruvi bilan).
import { Prisma } from "../generated/prisma/client.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { teglariniOl } from "./vazifa.ts";
import type { Vazifa, VazifaOzgarishi, YangiVazifa } from "./vazifa.ts";
import { kalitlar } from "./royxat-mantiq.ts";
import { KonfliktXatosi } from "../umumiy/xatolar.ts";
import type { AlmashtirishVazifasi, Filtr, KursorQiymati, RoyxatNatija, RoyxatSorovi, Saralash, Shart, TegSoni, VazifaOmbori, YozishNatijasi } from "./ombor.ts";
import { jonliManbaOl } from "../realtime/jonli.ts";
import { randomUUID } from "node:crypto";

type Tx = Prisma.TransactionClient;
type VazifaQatori = { id: bigint; matn: string; bajarildi: boolean; tartib: number; versiya: number; yaratilganVaqt: Date; yangilanganVaqt: Date };

const TANLOV = { id: true, matn: true, bajarildi: true, tartib: true, versiya: true, yaratilganVaqt: true, yangilanganVaqt: true } as const;
const QAYTA_URINISH = 5;

function son(x: bigint): number {
  const n = Number(x);
  if (!Number.isSafeInteger(n)) throw new RangeError(`bigint ${x.toString()} Number'ga sig'maydi`);
  return n;
}

function vazifa(q: VazifaQatori): Vazifa {
  return {
    id: son(q.id),
    matn: q.matn,
    bajarildi: q.bajarildi,
    teglar: teglariniOl(q.matn),
    yaratildi: q.yaratilganVaqt.toISOString(),
    yangilandi: q.yangilanganVaqt.toISOString(),
    tartib: q.tartib,
    versiya: q.versiya,
  };
}

/** Postgres SQLSTATE: adapter xatoni PrismaClientKnownRequestError ichiga o'raydi — asl kodni meta'dan olamiz */
function sqlHolat(x: unknown): string | undefined {
  if (!(x instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const sabab = (x.meta?.["driverAdapterError"] as { cause?: { originalCode?: string } } | undefined)?.cause;
  return sabab?.originalCode;
}

function takrorXatosi(x: unknown): unknown {
  const kod = sqlHolat(x);
  // 23P01 — 014 dagi EXCLUDE (matn noyobligi), 23505 — eski UNIQUE indeks
  if (kod === "23P01" || kod === "23505") {
    return new KonfliktXatosi("Bu vazifa ro'yxatda allaqachon bor", { kod: "takror-matn", sarlavha: "Takror vazifa", cause: x });
  }
  return x;
}

type Shartlar = Prisma.VazifaWhereInput;

function filtrShartlari(filtr: Filtr, egasi: bigint): Shartlar[] {
  const s: Shartlar[] = [{ egasiId: egasi, ochirilganVaqt: null }];
  if (filtr.bajarildi !== undefined) s.push({ bajarildi: filtr.bajarildi });
  // AND: har teg uchun "shunday bog'lanish bor" (EXISTS) — bazada teg "#" bilan
  for (const t of new Set(filtr.teglar ?? [])) s.push({ vazifaTeglari: { some: { teg: { nom: `#${t}` } } } });
  // contains + insensitive → ILIKE '%…%'. TOPILMA (holat 20, test): Prisma 7 qiymatdagi % va _ ni EKRANLAMAYDI — qidiruv "%" hamma
  // vazifani qaytardi (PgOmbori strpos bilan — yo'q). Shuning uchun LIKE maxsus belgilarini o'zimiz ekranlaymiz (Postgres sukut escape — \)
  if (filtr.qidiruv !== undefined) s.push({ matn: { contains: filtr.qidiruv.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" } });
  if (filtr.yaratildiDan !== undefined) s.push({ yaratilganVaqt: { gte: new Date(filtr.yaratildiDan) } });
  if (filtr.yaratildiGacha !== undefined) s.push({ yaratilganVaqt: { lt: new Date(filtr.yaratildiGacha) } });
  return s;
}

const MAYDON = { id: "id", tartib: "tartib", matn: "matn", bajarildi: "bajarildi", yaratildi: "yaratilganVaqt", yangilandi: "yangilanganVaqt" } as const;

function kursorQiymati(v: Vazifa, k: readonly Saralash[]): KursorQiymati {
  return k.map((s) => v[s.maydon]);
}

function prismaQiymat(maydon: Saralash["maydon"], x: string | number | boolean): unknown {
  if (maydon === "id") return BigInt(x);
  if (maydon === "yaratildi" || maydon === "yangilandi") return new Date(String(x));
  return x;
}

/** Keyset: k1 > x1 OR (k1 = x1 AND k2 > x2) … — Prisma where obyekti sifatida (row value'ni Prisma ifodalay olmaydi) */
function keyset(k: readonly Saralash[], keyin: KursorQiymati): Shartlar {
  if (keyin.length !== k.length) throw new Error("kursor kalitlari soni saralashga mos emas");
  const yoki: Shartlar[] = [];
  for (let i = 0; i < k.length; i++) {
    const va: Shartlar[] = [];
    for (let j = 0; j < i; j++) {
      const s = k[j];
      const x = keyin[j];
      if (s === undefined || x === undefined) continue;
      va.push({ [MAYDON[s.maydon]]: { equals: prismaQiymat(s.maydon, x) } });
    }
    const s = k[i];
    const x = keyin[i];
    if (s === undefined || x === undefined) continue;
    va.push({ [MAYDON[s.maydon]]: { [s.kamayish ? "lt" : "gt"]: prismaQiymat(s.maydon, x) } });
    yoki.push({ AND: va });
  }
  return { OR: yoki };
}

/** 29-qism B (holat 50): outbox — PgOmbori bilan bir xil shakl (sql/204; Prisma modeli Outbox) */
async function hodisa(tx: Tx, tur: string, egasi: bigint, v: Vazifa): Promise<void> {
  // createMany — RETURNING'siz (ilova roliga outbox'dan SELECT berilmagan; create() natijani qaytarish uchun o'qiydi)
  await tx.outbox.createMany({ data: [{ hodisaId: randomUUID(), tur, foydalanuvchiId: egasi, malumot: { id: v.id, matn: v.matn, bajarildi: v.bajarildi, versiya: v.versiya, manba: jonliManbaOl() } }] });
}

export class PrismaOmbori implements VazifaOmbori {
  readonly #db: PrismaClient;
  readonly #egasi: bigint;

  constructor(db: PrismaClient, egasiId: number) {
    this.#db = db;
    this.#egasi = BigInt(egasiId);
  }

  /**
   * O'qish (28 #20): interaktiv tranzaksiya, boshida set_config('ilova.foydalanuvchi_id') — vazifalar_api roli bilan RLS (105) shu bo'yicha ishlaydi.
   * Prisma'da "har so'rovga" sozlama yo'q — tranzaksiya yagona yo'l (Prisma hujjatidagi RLS misoli ham shunday, $extends bilan). Narxi — t20.
   */
  async #oqi<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.#db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('ilova.foydalanuvchi_id', ${this.#egasi.toString()}, true)`;
      return fn(tx);
    }, { timeout: 10_000, maxWait: 10_000 });
  }

  royxat(sorov: RoyxatSorovi): Promise<RoyxatNatija> {
    return this.#oqi((tx) => this.#royxat(tx, sorov));
  }

  async #royxat(db: Tx, sorov: RoyxatSorovi): Promise<RoyxatNatija> {
    const k = kalitlar(sorov.saralash);
    const asos = filtrShartlari(sorov.filtr, this.#egasi);
    const shart = [...asos];
    if (sorov.sahifa.tur === "kursor" && sorov.sahifa.keyin !== undefined) shart.push(keyset(k, sorov.sahifa.keyin));
    const olish = sorov.limit + 1;
    const otkaz = sorov.sahifa.tur === "offset" ? sorov.sahifa.offset : 0;
    let qatorlar: VazifaQatori[];
    if (k.some((s) => s.maydon === "matn")) {
      // Prisma orderBy'da collation yo'q: bazaning en_US.utf8 tartibi JS (kod nuqtasi) tartibidan farq qiladi (26 #17) — kursor buzilmasin.
      // Mos id'larni Prisma filtri bilan, tartibni raw SQL bilan (COLLATE "C") olamiz
      const mos = await db.vazifa.findMany({ where: { AND: asos }, select: { id: true } });
      const tartib = Prisma.raw(k.map((s) => `${ustunSql(s.maydon)} ${s.kamayish ? "DESC" : "ASC"}`).join(", "));
      const kursor = sorov.sahifa.tur === "kursor" && sorov.sahifa.keyin !== undefined ? keysetSql(k, sorov.sahifa.keyin) : Prisma.sql`true`;
      qatorlar = await db.$queryRaw<VazifaQatori[]>`
        SELECT id, matn, bajarildi, tartib, versiya, yaratilgan_vaqt AS "yaratilganVaqt", yangilangan_vaqt AS "yangilanganVaqt"
        FROM vazifalar WHERE id = ANY(${mos.map((m) => m.id)}::bigint[]) AND ${kursor} ORDER BY ${tartib} LIMIT ${olish} OFFSET ${otkaz}`;
    } else {
      qatorlar = await db.vazifa.findMany({
        where: { AND: shart },
        orderBy: k.map((s) => ({ [MAYDON[s.maydon]]: s.kamayish ? "desc" : "asc" })),
        take: olish,
        skip: otkaz,
        select: TANLOV,
      });
    }
    const borKeyingi = qatorlar.length > sorov.limit;
    const vazifalar = qatorlar.slice(0, sorov.limit).map(vazifa);
    const natija: RoyxatNatija = { vazifalar, borKeyingi, versiya: await this.#versiya(db) };
    const oxirgi = vazifalar.at(-1);
    if (borKeyingi && oxirgi !== undefined) natija.keyingi = kursorQiymati(oxirgi, k);
    if (sorov.jami === true) natija.jami = await db.vazifa.count({ where: { AND: asos } });
    return natija;
  }

  async #versiya(db: PrismaClient | Tx): Promise<number> {
    const f = await db.foydalanuvchi.findUnique({ where: { id: this.#egasi }, select: { vazifalarVersiyasi: true } });
    if (f === null) throw new Error(`foydalanuvchi ${this.#egasi.toString()} bazada yo'q`);
    return son(f.vazifalarVersiyasi);
  }

  soni(filtr: Filtr): Promise<number> {
    return this.#oqi((tx) => tx.vazifa.count({ where: { AND: filtrShartlari(filtr, this.#egasi) } }));
  }

  async ol(id: number): Promise<Vazifa | undefined> {
    const q = await this.#oqi((tx) => tx.vazifa.findFirst({ where: { id: BigInt(id), egasiId: this.#egasi, ochirilganVaqt: null }, select: TANLOV }));
    return q === null ? undefined : vazifa(q);
  }

  async yarat(yangi: YangiVazifa): Promise<Vazifa> {
    return this.#yoz(async (tx) => {
      const bajarildi = yangi.bajarildi ?? false;
      // tartib berilmaydi — BEFORE INSERT trigger (013) qo'yadi; RETURNING trigger qo'ygan qiymatni qaytaradi
      const q = await tx.vazifa.create({
        data: { egasiId: this.#egasi, matn: yangi.matn, bajarildi, bajarilganVaqt: bajarildi ? new Date() : null },
        select: TANLOV,
      });
      await this.#versiyaniOshir(tx);
      await hodisa(tx, "vazifa.yaratildi", this.#egasi, vazifa(q));
      return vazifa(q);
    });
  }

  async yangila(id: number, ozgarish: VazifaOzgarishi, shart?: Shart): Promise<YozishNatijasi<Vazifa>> {
    return this.#yoz(async (tx) => {
      const joriy = await tx.vazifa.findFirst({ where: { id: BigInt(id), egasiId: this.#egasi, ochirilganVaqt: null }, select: { ...TANLOV, bajarilganVaqt: true } });
      if (joriy === null) return { tur: "topilmadi" };
      if (shart !== undefined && joriy.versiya !== shart.versiya) return { tur: "konflikt", joriy: vazifa(joriy) };
      const bajarildi = ozgarish.bajarildi ?? joriy.bajarildi;
      // Optimistik qulf baribir WHERE'da (o'qish va yozish orasida boshqa yozuvchi bo'lmasa ham — egasi qulfi bor — ikkinchi himoya)
      const n = await tx.vazifa.updateMany({
        where: { id: joriy.id, versiya: joriy.versiya },
        data: {
          ...(ozgarish.matn === undefined ? {} : { matn: ozgarish.matn }),
          bajarildi,
          bajarilganVaqt: bajarildi ? (joriy.bajarilganVaqt ?? new Date()) : null,
        },
      });
      if (n.count !== 1) return { tur: "konflikt", joriy: vazifa(joriy) };
      const q = await tx.vazifa.findUniqueOrThrow({ where: { id: joriy.id }, select: TANLOV });
      await this.#versiyaniOshir(tx);
      await hodisa(tx, "vazifa.yangilandi", this.#egasi, vazifa(q));
      if (!joriy.bajarildi && bajarildi) await hodisa(tx, "vazifa.bajarildi", this.#egasi, vazifa(q));
      return { tur: "ok", qiymat: vazifa(q) };
    });
  }

  async ochir(id: number, shart?: Shart): Promise<YozishNatijasi<null>> {
    return this.#yoz(async (tx) => {
      const n = await tx.vazifa.updateMany({
        where: { id: BigInt(id), egasiId: this.#egasi, ochirilganVaqt: null, ...(shart === undefined ? {} : { versiya: shart.versiya }) },
        data: { ochirilganVaqt: new Date() },
      });
      if (n.count !== 1) {
        const joriy = await tx.vazifa.findFirst({ where: { id: BigInt(id), egasiId: this.#egasi, ochirilganVaqt: null }, select: TANLOV });
        return joriy === null ? { tur: "topilmadi" } : { tur: "konflikt", joriy: vazifa(joriy) };
      }
      await this.#versiyaniOshir(tx);
      await hodisa(tx, "vazifa.ochirildi", this.#egasi, vazifa(await tx.vazifa.findUniqueOrThrow({ where: { id: BigInt(id) }, select: TANLOV })));
      return { tur: "ok", qiymat: null };
    });
  }

  async #versiyaniOshir(tx: Tx): Promise<number> {
    const f = await tx.foydalanuvchi.update({ where: { id: this.#egasi }, data: { vazifalarVersiyasi: { increment: 1 } }, select: { vazifalarVersiyasi: true } });
    return son(f.vazifalarVersiyasi);
  }

  /** Interaktiv tranzaksiya + egasi qatori FOR UPDATE (PgOmbori #yoz bilan bir xil qulf tartibi); deadlock/serializatsiya — qayta urinish */
  async #yoz<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let urinish = 1; ; urinish++) {
      try {
        return await this.#db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('ilova.foydalanuvchi_id', ${this.#egasi.toString()}, true)`;
          await tx.$executeRaw`SELECT 1 FROM foydalanuvchilar WHERE id = ${this.#egasi} FOR UPDATE`;
          return fn(tx);
        }, { timeout: 10_000, maxWait: 10_000 });
      } catch (x) {
        const kod = sqlHolat(x);
        // P2034 — Prisma'ning "write conflict or deadlock" kodi; asl SQLSTATE ham tekshiriladi
        const qayta = kod === "40P01" || kod === "40001" || (x instanceof Prisma.PrismaClientKnownRequestError && x.code === "P2034");
        if (!qayta || urinish >= QAYTA_URINISH) throw takrorXatosi(x);
        await new Promise((r) => setTimeout(r, Math.random() * 10 * 2 ** urinish));
      }
    }
  }

  async teglar(): Promise<TegSoni[]> {
    // Prisma groupBy relation orqali (teglar → vazifa_teglari → vazifalar.ochirilgan_vaqt) guruhlay olmaydi — raw SQL
    return this.#oqi((tx) => tx.$queryRaw<TegSoni[]>`
      SELECT substr(t.nom, 2) AS teg, count(*)::int AS soni
      FROM teglar t JOIN vazifa_teglari vt ON vt.teg_id = t.id JOIN vazifalar v ON v.id = vt.vazifa_id
      WHERE t.egasi_id = ${this.#egasi} AND v.ochirilgan_vaqt IS NULL
      GROUP BY t.nom ORDER BY soni DESC, substr(t.nom, 2) COLLATE "C"`);
  }

  async almashtirHammasi(yangilar: readonly AlmashtirishVazifasi[]): Promise<{ vazifalar: Vazifa[]; versiya: number }> {
    return this.#yoz(async (tx) => {
      const berilgan = [...new Set(yangilar.flatMap((y) => (y.id === undefined ? [] : [BigInt(y.id)])))];
      const mavjud = await tx.vazifa.findMany({ where: { id: { in: berilgan } }, select: { id: true, egasiId: true } });
      const ozimniki = new Set(mavjud.filter((m) => m.egasiId === this.#egasi).map((m) => son(m.id)));
      // 28 #20: RLS ostida begona qatorlar findMany'da ko'rinmaydi — band id'lar SECURITY DEFINER funksiyadan (119)
      const [band] = await tx.$queryRaw<{ b: bigint[] }[]>`SELECT vazifa_idlari_band(${berilgan}::bigint[]) AS b`;
      const begona = new Set((band?.b ?? []).map(son).filter((id) => !ozimniki.has(id)));
      const [seq] = await tx.$queryRaw<{ keyingi: bigint }[]>`SELECT (CASE WHEN is_called THEN last_value + 1 ELSE last_value END)::bigint AS keyingi FROM vazifalar_id_seq`;
      let keyingi = Math.max(son(seq?.keyingi ?? 1n), ...berilgan.map(son).filter((id) => !begona.has(id)).map((id) => id + 1));
      const ishlatildi = new Set<number>();
      const idlar = yangilar.map((y) => {
        const id = y.id !== undefined && !ishlatildi.has(y.id) && !begona.has(y.id) ? y.id : keyingi++;
        ishlatildi.add(id);
        return id;
      });
      await tx.vazifa.updateMany({ where: { egasiId: this.#egasi, ochirilganVaqt: null, id: { notIn: idlar.map((x) => BigInt(x)) } }, data: { ochirilganVaqt: new Date() } });
      const ustunlar = (tanla: (i: number) => boolean) => {
        const j = yangilar.flatMap((_, i) => (tanla(i) ? [i] : []));
        return {
          id: j.map((i) => BigInt(idlar[i] ?? 0)),
          matn: j.map((i) => yangilar[i]?.matn ?? ""),
          bajarildi: j.map((i) => yangilar[i]?.bajarildi ?? false),
          tartib: j.map((i) => i + 1),
        };
      };
      const bor = (i: number) => ozimniki.has(idlar[i] ?? 0);
      // #46: ommaviy yozuv unnest bilan — Prisma updateMany har qatorga turli qiymat bera olmaydi, createMany OVERRIDING SYSTEM VALUE bermaydi
      const u = ustunlar(bor);
      await tx.$executeRaw`
        UPDATE vazifalar v SET matn = u.matn, bajarildi = u.bajarildi,
          bajarilgan_vaqt = CASE WHEN u.bajarildi THEN coalesce(v.bajarilgan_vaqt, now()) END, tartib = u.tartib, ochirilgan_vaqt = NULL
        FROM unnest(${u.id}::bigint[], ${u.matn}::text[], ${u.bajarildi}::boolean[], ${u.tartib}::int[]) AS u(id, matn, bajarildi, tartib)
        WHERE v.id = u.id AND v.egasi_id = ${this.#egasi}`;
      const y = ustunlar((i) => !bor(i));
      await tx.$executeRaw`
        INSERT INTO vazifalar (id, egasi_id, matn, bajarildi, bajarilgan_vaqt, tartib) OVERRIDING SYSTEM VALUE
        SELECT u.id, ${this.#egasi}, u.matn, u.bajarildi, CASE WHEN u.bajarildi THEN now() END, u.tartib
        FROM unnest(${y.id}::bigint[], ${y.matn}::text[], ${y.bajarildi}::boolean[], ${y.tartib}::int[]) AS u(id, matn, bajarildi, tartib)`;
      await tx.$executeRaw`SELECT setval('vazifalar_id_seq', greatest((SELECT max(id) FROM vazifalar), (SELECT last_value FROM vazifalar_id_seq)))`;
      const versiya = await this.#versiyaniOshir(tx);
      const qatorlar = await tx.vazifa.findMany({ where: { id: { in: idlar.map((x) => BigInt(x)) } }, orderBy: [{ tartib: "asc" }, { id: "asc" }], select: TANLOV });
      return { vazifalar: qatorlar.map(vazifa), versiya };
    });
  }
}

const MAYDON_SQL = { id: "id", tartib: "tartib", matn: 'matn COLLATE "C"', bajarildi: "bajarildi", yaratildi: "yaratilgan_vaqt", yangilandi: "yangilangan_vaqt" } as const;
const MAYDON_TUR = { id: "bigint", tartib: "integer", matn: "text", bajarildi: "boolean", yaratildi: "timestamptz", yangilandi: "timestamptz" } as const;

/** Ustun ifodasi — faqat oq ro'yxatdan (foydalanuvchi matni SQL'ga tushmaydi) */
function ustunSql(maydon: Saralash["maydon"]): string {
  if (!Object.hasOwn(MAYDON_SQL, maydon)) throw new Error(`saralash maydoni oq ro'yxatda yo'q: ${maydon}`);
  return MAYDON_SQL[maydon];
}

/** Raw SQL keyset (COLLATE "C" bilan — ORDER BY bilan bir xil tartib); qiymatlar parametr ($n) */
function keysetSql(k: readonly Saralash[], keyin: KursorQiymati): Prisma.Sql {
  if (keyin.length !== k.length) throw new Error("kursor kalitlari soni saralashga mos emas");
  const qism = k.map((s, i) => {
    const teng = k.slice(0, i).map((t, j) => Prisma.sql`${Prisma.raw(ustunSql(t.maydon))} = ${keyin[j]}::${Prisma.raw(MAYDON_TUR[t.maydon])}`);
    teng.push(Prisma.sql`${Prisma.raw(ustunSql(s.maydon))} ${Prisma.raw(s.kamayish ? "<" : ">")} ${keyin[i]}::${Prisma.raw(MAYDON_TUR[s.maydon])}`);
    return Prisma.sql`(${Prisma.join(teng, " AND ")})`;
  });
  return Prisma.sql`(${Prisma.join(qism, " OR ")})`;
}
