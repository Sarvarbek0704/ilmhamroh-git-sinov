// soxta/eskiz.ts — Eskiz SMS API'ning lokal MOCK serveri (notify.eskiz.uz Postman hujjati, 2026-10-27 bo'yicha):
//   POST /api/auth/login (form-data email, password) → {message:"token_generated", data:{token}, token_type:"bearer"}
//   PATCH /api/auth/refresh → yangi token;  POST /api/message/sms/send (Bearer; mobile_phone, message, from, callback_url)
//   → {id, message:"Waiting for SMS provider", status:"waiting"}; callback_url ga POST {request_id, message_id, phone_number, status:"DELIVRD", …}
// FARQLAR (haqiqiy API bilan sinalmagan): xato javoblari tanasi va kodlari (401/422/429 shakli) taxminiy; token muddati qo'lda (`tokenniEskirt`);
// test rejimi — hujjatdagi 3 ta ruxsat etilgan matn; balans/limit, nick (`from`) tekshiruvi yo'q.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

export const TEST_MATNLAR = ["Это тест от Eskiz", "Bu Eskiz dan test", "This is test from Eskiz"];

export type SoxtaEskiz = {
  url: string;
  yuborilgan: { id: string; tel: string; matn: string; from: string; callback?: string }[];
  loginSoni: () => number;
  tokenniEskirt: () => void;
  keyingiJavob: (status: number) => void;
  yop: () => Promise<void>;
};

async function formaOqi(req: IncomingMessage): Promise<Record<string, string>> {
  const bolaklar: Buffer[] = [];
  for await (const b of req) bolaklar.push(b as Buffer);
  const fd = await new Response(Buffer.concat(bolaklar), { headers: { "content-type": req.headers["content-type"] ?? "" } }).formData();
  return Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === "string" ? v : v.name]));
}

export async function soxtaEskiz(o: { email: string; parol: string; testRejim?: boolean; callbackKechikishMs?: number }): Promise<SoxtaEskiz> {
  const tokenlar = new Set<string>();
  const yuborilgan: SoxtaEskiz["yuborilgan"] = [];
  let login = 0;
  let majburiy: number | undefined;
  const json = (res: ServerResponse, s: number, b: unknown) => { res.writeHead(s, { "content-type": "application/json" }).end(JSON.stringify(b)); };
  const srv: Server = createServer((req, res) => {
    void (async () => {
      const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      if (req.method === "POST" && req.url === "/api/auth/login") {
        login++;
        const f = await formaOqi(req);
        if (f["email"] !== o.email || f["password"] !== o.parol) { json(res, 401, { message: "Unauthorized" }); return; }
        const t = randomUUID();
        tokenlar.add(t);
        json(res, 200, { message: "token_generated", data: { token: t }, token_type: "bearer" });
        return;
      }
      if (!auth || !tokenlar.has(auth)) { json(res, 401, { message: "Expired" }); return; }
      if (req.method === "PATCH" && req.url === "/api/auth/refresh") {
        tokenlar.delete(auth);
        const t = randomUUID();
        tokenlar.add(t);
        json(res, 200, { message: "token_generated", data: { token: t }, token_type: "bearer" });
        return;
      }
      if (req.method === "POST" && req.url === "/api/message/sms/send") {
        if (majburiy !== undefined) { const s = majburiy; majburiy = undefined; json(res, s, { message: `soxta ${String(s)}` }); return; }
        const f = await formaOqi(req);
        const tel = f["mobile_phone"] ?? "";
        const matn = f["message"] ?? "";
        if (!/^998\d{9}$/.test(tel) || matn === "") { json(res, 422, { message: "mobile_phone yoki message noto'g'ri" }); return; }
        if (o.testRejim && !TEST_MATNLAR.includes(matn)) { json(res, 400, { message: "Test rejimida faqat test matnlari", status: "error" }); return; }
        const id = randomUUID();
        const cb = f["callback_url"];
        yuborilgan.push({ id, tel, matn, from: f["from"] ?? "", ...(cb ? { callback: cb } : {}) });
        json(res, 200, { id, message: "Waiting for SMS provider", status: "waiting" });
        if (cb) {
          setTimeout(() => {
            void fetch(cb, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request_id: id, message_id: String(Date.now()), country: "UZ", phone_number: tel, sms_count: "1", status: "DELIVRD", status_date: new Date().toISOString().replace("T", " ").slice(0, 19) }) }).catch(() => undefined);
          }, o.callbackKechikishMs ?? 20);
        }
        return;
      }
      json(res, 404, { message: "Not found" });
    })();
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${String((srv.address() as AddressInfo).port)}`,
    yuborilgan,
    loginSoni: () => login,
    tokenniEskirt: () => { tokenlar.clear(); },
    keyingiJavob: (s) => { majburiy = s; },
    yop: () => new Promise((r) => { srv.closeAllConnections(); srv.close(() => { r(); }); }),
  };
}
