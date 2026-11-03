// yopish.ts — graceful shutdown: yangi ulanish yo'q, boshlangan so'rovlar tugaydi, bo'sh keep-alive'lar yopiladi
import type { Server } from "node:http";

/**
 * server.close() yolg'iz yetmaydi: javob berib bo'lgan keep-alive ulanish keepAliveTimeout + 1 s
 * (Node 24 keepAliveTimeoutBuffer) kutadi — t07 da close() callback 7.4 s. Shuning uchun har 100 ms
 * bo'sh ulanishlarni yopamiz; `kutishMs` dan keyin qolganini majburan uzamiz.
 * @returns true — hammasi o'z vaqtida tugadi; false — majburan uzildi
 */
export function yop(server: Server, kutishMs = 10_000): Promise<boolean> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve(true);
      return;
    }
    const iv = setInterval(() => { server.closeIdleConnections(); }, 100);
    const majburiy = setTimeout(() => {
      server.closeAllConnections();
      tugat(false);
    }, kutishMs);
    function tugat(ozVaqtida: boolean): void {
      clearInterval(iv);
      clearTimeout(majburiy);
      resolve(ozVaqtida);
    }
    server.close(() => { tugat(true); });
    server.closeIdleConnections();
  });
}
