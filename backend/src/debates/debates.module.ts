import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { debateEntities } from "../database/typeorm.config";
import { JudgeModule } from "../judge/judge.module";
import { DebatesController } from "./debates.controller";
import { DebatesService } from "./debates.service";

@Module({
  imports: [TypeOrmModule.forFeature([...debateEntities]), JudgeModule],
  controllers: [DebatesController],
  providers: [DebatesService],
  exports: [DebatesService],
})
export class DebatesModule {}
