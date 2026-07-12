import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GeminiModule } from "../ai/gemini/gemini.module";
import { debateEntities } from "../database/typeorm.config";
import { FactCheckBatchTaskService } from "./fact-check-batch-task.service";
import { FactCheckInputAssembler } from "./fact-check-input.assembler";
import { FactCheckerAiService } from "./fact-checker-ai.service";
import { FACT_CHECK_QUEUE } from "./queues/fact-check.constants";
import { FactCheckProcessor } from "./queues/fact-check.processor";

@Module({
  imports: [
    TypeOrmModule.forFeature([...debateEntities]),
    BullModule.registerQueue({
      name: FACT_CHECK_QUEUE,
    }),
    GeminiModule,
  ],
  providers: [
    FactCheckBatchTaskService,
    FactCheckInputAssembler,
    FactCheckerAiService,
    FactCheckProcessor,
  ],
  exports: [FactCheckBatchTaskService],
})
export class FactCheckModule {}
