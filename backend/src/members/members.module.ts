import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { MemberEntity } from "./entities/member.entity";
import { MembersController } from "./members.controller";
import { MembersService } from "./members.service";

@Module({
  imports: [TypeOrmModule.forFeature([MemberEntity])],
  controllers: [MembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
