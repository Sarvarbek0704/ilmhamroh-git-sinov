// eksport.module.ts — eksport xususiyat moduli
import { Module } from "@nestjs/common";
import { EksportController } from "./eksport.controller.ts";
import { EksportService } from "./eksport.service.ts";

@Module({
  controllers: [EksportController],
  providers: [EksportService],
})
export class EksportModule {}
