import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CommunityChatController } from "./community-chat.controller";
import { CommunityChatService } from "./community-chat.service";
import { CommunityEntity } from "./entities/community.entity";
import { CommunityMemberEntity } from "./entities/community-member.entity";
import { CommunityMessageEntity } from "./entities/community-message.entity";
import { CommunityOpinionEntity } from "./entities/community-opinion.entity";
import { CommunityNotificationService } from "./community-notification.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CommunityEntity,
      CommunityMemberEntity,
      CommunityMessageEntity,
      CommunityOpinionEntity,
    ]),
  ],
  controllers: [CommunityChatController],
  providers: [CommunityChatService, CommunityNotificationService],
  exports: [CommunityChatService, CommunityNotificationService],
})
export class CommunityChatModule {}
