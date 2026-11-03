// hujjat.ts — #44 NS-43: OpenAPI hujjati — @nestjs/swagger. Kirish sxemalari — o'sha Zod sxemalari: Zod 4 Standard JSON Schema'ni qo'llaydi,
// Nest 12 swagger ularni konverter'siz OpenAPI 3.0 ga aylantiradi (DTO klasslari va CLI plugin kerak emas).
// /docs — Swagger UI, /docs-json — mijoz generatsiyasi uchun JSON (openapi-typescript, orval…)
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { OpenAPIObject } from "@nestjs/swagger";
import type { INestApplication } from "@nestjs/common";

export function hujjatYarat(app: INestApplication): OpenAPIObject {
  const sozlama = new DocumentBuilder()
    .setTitle("vazifalar-api")
    .setDescription("vazifalar ilovasining REST API'si (v1). Xatolar — application/problem+json (RFC 9457). Batafsil: API.md")
    .setVersion("2.1.0")
    .build();
  // operationId — metod nomi (sukut "VazifalarController_royxat[0]_v1": versiyalar massivi uchun Nest metod nomiga "[0]" qo'shadi — olib tashlaymiz)
  const hujjat = SwaggerModule.createDocument(app, sozlama, { operationIdFactory: (_klass, metod) => metod.replace(/\[\d+\]$/, "") });
  // eskirgan versiyasiz yo'llar (/vazifalar) — hujjatda yo'q, faqat /v1
  hujjat.paths = Object.fromEntries(Object.entries(hujjat.paths).filter(([yol]) => yol.startsWith("/v1/")));
  return hujjat;
}

export function hujjatniUla(app: INestApplication): void {
  const hujjat = hujjatYarat(app);
  SwaggerModule.setup("docs", app, hujjat, { jsonDocumentUrl: "docs-json" });
}
