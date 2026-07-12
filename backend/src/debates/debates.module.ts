import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { debateEntities } from "../database/typeorm.config";
import { DebatesController } from "./debates.controller";
import { DebatesService } from "./debates.service";

@Module({
  imports: [TypeOrmModule.forFeature([...debateEntities])],
  controllers: [DebatesController],
  providers: [DebatesService],
  exports: [DebatesService],
})
export class DebatesModule {}
