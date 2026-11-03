// vazifalar.module.ts — vazifalar xususiyat moduli: controller'lar + xizmat. Ombor, log — global modullardan (token bilan).
// configure() — #21: Idempotency-Key middleware'i FAQAT shu controller marshrutlariga (25 dagi `v1.use("/vazifalar", idempotentlik(...))`)
import { Module } from "@nestjs/common";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { VazifalarController } from "./vazifalar.controller.ts";
import { TeglarController } from "./teglar.controller.ts";
import { VazifalarService } from "./vazifalar.service.ts";
import { WebhookTinglovchi } from "./vazifalar.tinglovchi.ts";
import { IdempotentlikMiddleware } from "../umumiy/idempotentlik.middleware.ts";

@Module({
  controllers: [VazifalarController, TeglarController],
  providers: [VazifalarService, WebhookTinglovchi],
  // boshqa modul (masalan eksport) xizmatdan foydalanmoqchi bo'lsa — eksport qilinadi
  exports: [VazifalarService],
})
export class VazifalarModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(IdempotentlikMiddleware).forRoutes(VazifalarController);
  }
}
