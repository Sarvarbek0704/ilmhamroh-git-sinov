// qidiruv.ts — 31-qism #17 (B-208) semantik qidiruv va #18 (B-209) RAG uchun topish (retrieval).
//   embedding'lar — dangasa (lazy) yangilanadi: qidiruvdan oldin shu foydalanuvchining yangi/o'zgargan (matn_hash) vazifalari paketlab hisoblanadi.
//   semantik — pgvector HNSW (cosine); gibrid — FTS (29: `qidiruv` tsvector, uz_normal) + vektor, Reciprocal Rank Fusion (RRF, k = 60).
import type { Pool, PoolClient } from "pg";
/** pgvector matn shakli `[0.1,0.2,…]` — JSON massivi bilan bir xil (pgvector npm paketi kerak emas) */
const vektorSql = (v: number[]): string => JSON.stringify(v);
import { egasiSifatida } from "../umumiy/rls.ts";
import type { LlmProvayder } from "./llm.ts";

export type Topilgan = { id: number; matn: string; bajarildi: boolean; muddat: string | null; ball: number };
export type QidiruvSozlamasi = { pool: Pool; provayder: LlmProvayder; model: string; tz: string; paket?: number };

/** bitta embedding so'rovida ko'pi bilan nechta matn (Gemini batchEmbedContents — 100) */
const PAKET = 100;
const RRF_K = 60;

export class Qidiruv {
  constructor(private readonly s: QidiruvSozlamasi) {}

  /** yangi va matni o'zgargan vazifalar uchun embedding (bir chaqiruvda ≤ 100 ta); qaytaradi — nechta hisoblandi */
  async yangila(egasi: number, signal?: AbortSignal): Promise<number> {
    const paket = this.s.paket ?? PAKET;
    let jami = 0;
    for (;;) {
      const eskilar = await egasiSifatida(this.s.pool, egasi, async (c) => (await c.query<{ id: string; matn: string; h: Buffer }>(
        `SELECT v.id, v.matn, sha256(convert_to(v.matn, 'UTF8')) AS h FROM vazifalar v
           LEFT JOIN vazifa_embeddinglar e ON e.vazifa_id = v.id
          WHERE v.egasi_id = $1 AND v.ochirilgan_vaqt IS NULL
            AND (e.vazifa_id IS NULL OR e.matn_hash <> sha256(convert_to(v.matn, 'UTF8')) OR e.model <> $2)
          ORDER BY v.id LIMIT $3`, [egasi, this.s.model, paket])).rows);
      if (eskilar.length === 0) return jami;
      const vektorlar = await this.s.provayder.embedding(eskilar.map((q) => q.matn), "hujjat", signal);
      await egasiSifatida(this.s.pool, egasi, async (c) => {
        await c.query(
          `INSERT INTO vazifa_embeddinglar (vazifa_id, egasi_id, model, matn_hash, embedding)
           SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::bytea[], $5::vector[])
           ON CONFLICT (vazifa_id) DO UPDATE SET model = EXCLUDED.model, matn_hash = EXCLUDED.matn_hash, embedding = EXCLUDED.embedding, yangilangan_vaqt = now()`,
          [eskilar.map((q) => q.id), eskilar.map(() => egasi), eskilar.map(() => this.s.model), eskilar.map((q) => q.h), vektorlar.map((v) => vektorSql(v))]);
      });
      jami += eskilar.length;
      if (eskilar.length < paket) return jami;
    }
  }

  async #vektorbilan(c: PoolClient, egasi: number, v: number[], k: number): Promise<Topilgan[]> {
    // pgvector 0.8: filtr (egasi) HNSW natijasidan KEYIN qo'llanadi — ef_search (40) ta yaqindan boshqalarniki chiqib ketsa, natija kam bo'ladi.
    // iterative_scan — kerakli son topilguncha indeksni davom ettiradi (t08 o'lchovi)
    await c.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
    return (await c.query<Topilgan & { id: string }>(
      `SELECT v.id, v.matn, v.bajarildi, to_char(v.muddat AT TIME ZONE $4, 'YYYY-MM-DD HH24:MI') AS muddat, 1 - (e.embedding <=> $2) AS ball
         FROM vazifa_embeddinglar e JOIN vazifalar v ON v.id = e.vazifa_id
        WHERE e.egasi_id = $1 AND v.ochirilgan_vaqt IS NULL
        ORDER BY e.embedding <=> $2 LIMIT $3`, [egasi, vektorSql(v), k, this.s.tz])).rows.map((r) => ({ ...r, id: Number(r.id) })); // float8 — pg o'zi number qiladi; bigint id — satr
  }

  async semantik(egasi: number, savol: string, k: number, signal?: AbortSignal): Promise<Topilgan[]> {
    await this.yangila(egasi, signal);
    const [v] = await this.s.provayder.embedding([savol], "sorov", signal);
    if (v === undefined) return [];
    return egasiSifatida(this.s.pool, egasi, (c) => this.#vektorbilan(c, egasi, v, k));
  }

  /** gibrid: FTS (so'z mosligi — nom, raqam, teg) + vektor (ma'no) → RRF: ball = Σ 1/(k + o'rin) */
  async gibrid(egasi: number, savol: string, k: number, signal?: AbortSignal): Promise<Topilgan[]> {
    await this.yangila(egasi, signal);
    const [v] = await this.s.provayder.embedding([savol], "sorov", signal);
    return egasiSifatida(this.s.pool, egasi, async (c) => {
      const vektor = v === undefined ? [] : await this.#vektorbilan(c, egasi, v, k * 2);
      // OR semantikasi: plainto_tsquery so'zlarni AND bilan bog'laydi — savolda ortiqcha so'z bo'lsa hech narsa topilmaydi
      const fts = (await c.query<Topilgan & { id: string }>(
        `WITH s AS (SELECT nullif(replace(plainto_tsquery('simple', uz_normal($2))::text, '&', '|'), '')::tsquery AS q)
         SELECT v.id, v.matn, v.bajarildi, to_char(v.muddat AT TIME ZONE $4, 'YYYY-MM-DD HH24:MI') AS muddat, ts_rank(v.qidiruv, s.q) AS ball
           FROM vazifalar v, s WHERE v.egasi_id = $1 AND v.ochirilgan_vaqt IS NULL AND s.q IS NOT NULL AND v.qidiruv @@ s.q
          ORDER BY ball DESC, v.id LIMIT $3`, [egasi, savol, k * 2, this.s.tz])).rows.map((r) => ({ ...r, id: Number(r.id) }));
      const ballar = new Map<number, Topilgan>();
      for (const royxat of [vektor, fts]) {
        royxat.forEach((t, i) => {
          const b = ballar.get(t.id) ?? { ...t, ball: 0 };
          b.ball += 1 / (RRF_K + i + 1);
          ballar.set(t.id, b);
        });
      }
      return [...ballar.values()].sort((a, b) => b.ball - a.ball || a.id - b.id).slice(0, k);
    });
  }
}
