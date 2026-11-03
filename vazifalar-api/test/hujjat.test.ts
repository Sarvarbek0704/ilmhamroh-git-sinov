// hujjat.test.ts — #44: OpenAPI hujjati Zod sxemalaridan (Standard JSON Schema) — kirish sxemalari hujjatda, faqat /v1, 405 yordamchilari yo'q
import { expect, test } from "vitest";
import request from "supertest";
import { XotiraOmbori } from "../src/vazifalar/xotira-ombor.ts";
import { httpIlova } from "./yordamchi.ts";

type Hujjat = { openapi: string; paths: Record<string, Record<string, { operationId: string; requestBody?: { content: Record<string, { schema: { properties?: Record<string, unknown>; required?: string[] } }> }; parameters?: { name: string; in: string }[] }>> };

test("GET /docs-json: OpenAPI 3, faqat /v1 yo'llari, metodlar — haqiqiylari (@All yo'q), tana sxemasi Zod'dan", async () => {
  const r = await request(await httpIlova({ ombor: new XotiraOmbori() })).get("/docs-json").expect(200);
  const h = r.body as Hujjat;
  expect(h.openapi).toMatch(/^3\./);
  expect(Object.keys(h.paths).sort()).toEqual(["/v1/eksportlar", "/v1/eksportlar/{id}", "/v1/eksportlar/{id}/fayl", "/v1/teglar", "/v1/vazifalar", "/v1/vazifalar/oqim", "/v1/vazifalar/toplam", "/v1/vazifalar/{id}"]); // /health/* — versiyasiz, hujjatga kirmaydi
  expect(Object.keys(h.paths["/v1/vazifalar"] ?? {}).sort()).toEqual(["get", "post", "put"]);
  expect(Object.keys(h.paths["/v1/vazifalar/{id}"] ?? {}).sort()).toEqual(["delete", "get", "patch", "put"]);
  const post = h.paths["/v1/vazifalar"]?.["post"];
  expect(post?.operationId).toBe("yarat");
  const sxema = post?.requestBody?.content["application/json"]?.schema;
  expect(sxema?.properties?.["matn"]).toMatchObject({ type: "string", minLength: 1, maxLength: 100 });
  expect(sxema?.required).toEqual(["matn"]);
  expect(h.paths["/v1/vazifalar"]?.["get"]?.parameters?.map((p) => p.name)).toContain("cursor");
});

test("GET /docs — Swagger UI sahifasi", async () => {
  const r = await request(await httpIlova({ ombor: new XotiraOmbori() })).get("/docs").expect(200);
  expect(r.text).toMatch(/swagger-ui/i);
});
