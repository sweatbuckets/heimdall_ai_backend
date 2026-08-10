import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { AnalyzerModule } from "../analyzer/analyzer.module";
import { AuthModule } from "../auth/auth.module";
import { CommunityChatModule } from "../community-chat/community-chat.module";
import { DEBATE_CHAT_REDIS } from "./debate-chat.constants";
import { DebateChatController } from "./debate-chat.controller";
import { DebateChatService } from "./debate-chat.service";
import { DebateChatWebSocketServer } from "./debate-chat.websocket-server";
import { DebateTurnTimeoutScheduler } from "./debate-turn-timeout.scheduler";

@Module({
  imports: [AnalyzerModule, AuthModule, CommunityChatModule],
  controllers: [DebateChatController],
  providers: [
    {
      provide: DEBATE_CHAT_REDIS,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis => {
        const password = configService.get<string>("REDIS_PASSWORD");

        return new Redis({
          host: configService.get<string>("REDIS_HOST", "localhost"),
          port: configService.get<number>("REDIS_PORT", 6379),
          ...(password ? { password } : {}),
        });
      },
    },
    DebateChatService,
    DebateChatWebSocketServer,
    DebateTurnTimeoutScheduler,
  ],
  exports: [DebateChatService, DebateChatWebSocketServer],
})
export class DebateChatModule {}
