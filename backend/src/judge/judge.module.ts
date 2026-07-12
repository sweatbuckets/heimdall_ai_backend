import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GeminiModule } from "../ai/gemini/gemini.module";
import { debateEntities } from "../database/typeorm.config";
import { JudgeAiService } from "./judge-ai.service";
import { JudgeController } from "./judge.controller";
import { JudgeInputAssembler } from "./judge-input.assembler";
import { JudgeService } from "./judge.service";

@Module({
  imports: [TypeOrmModule.forFeature([...debateEntities]), GeminiModule],
  controllers: [JudgeController],
  providers: [JudgeService, JudgeInputAssembler, JudgeAiService],
  exports: [JudgeService],
})
export class JudgeModule {}
