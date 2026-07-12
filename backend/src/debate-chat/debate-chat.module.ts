import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { AnalyzerModule } from "../analyzer/analyzer.module";
import { DEBATE_CHAT_REDIS } from "./debate-chat.constants";
import { DebateChatController } from "./debate-chat.controller";
import { DebateChatService } from "./debate-chat.service";
import { DebateChatWebSocketServer } from "./debate-chat.websocket-server";

@Module({
  imports: [AnalyzerModule],
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
  ],
  exports: [DebateChatService],
})
export class DebateChatModule {}
