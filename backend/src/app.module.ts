import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DebatesModule } from "./debates/debates.module";
import { envValidationSchema } from "./config/env.validation";
import { createTypeOrmOptions } from "./database/typeorm.config";
import { AnalyzerModule } from "./analyzer/analyzer.module";
import { FactCheckModule } from "./fact-check/fact-check.module";
import { JudgeModule } from "./judge/judge.module";
import { DebateChatModule } from "./debate-chat/debate-chat.module";
import { MembersModule } from "./members/members.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    TypeOrmModule.forRootAsync({
      useFactory: createTypeOrmOptions,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const password = configService.get<string>("REDIS_PASSWORD");

        return {
          connection: {
            host: configService.get<string>("REDIS_HOST", "localhost"),
            port: configService.get<number>("REDIS_PORT", 6379),
            ...(password ? { password } : {}),
          },
        };
      },
    }),
    MembersModule,
    DebatesModule,
    AnalyzerModule,
    FactCheckModule,
    JudgeModule,
    DebateChatModule,
  ],
})
export class AppModule {}
