import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger("RuntimeConfig");
  const configService = app.get(ConfigService);
  const port = configService.get<number>("PORT", 3000);

  logger.log(
    [
      "AI pipeline timeouts (ms):",
      `analyzer=${configService.get<number>("GEMINI_ANALYZER_TIMEOUT_MS", 70000)}`,
      `grounding=${configService.get<number>("GEMINI_FACT_CHECK_GROUNDING_TIMEOUT_MS", 90000)}`,
      `synthesis=${configService.get<number>("GEMINI_FACT_CHECK_SYNTHESIS_TIMEOUT_MS", 70000)}`,
      `judge=${configService.get<number>("GEMINI_JUDGE_TIMEOUT_MS", 40000)}`,
    ].join(" "),
  );
  logger.log(
    [
      "AI pipeline stale thresholds (ms):",
      `analyzer=${configService.get<number>("ANALYZER_PROCESSING_STALE_MS", 80000)}`,
      `factCheck=${configService.get<number>("FACT_CHECK_PROCESSING_STALE_MS", 200000)}`,
      `judge=${configService.get<number>("JUDGE_PROCESSING_STALE_MS", 75000)}`,
    ].join(" "),
  );

  await app.listen(port);
}

void bootstrap();
