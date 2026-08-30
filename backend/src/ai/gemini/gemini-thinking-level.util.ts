import { ThinkingLevel } from "@google/genai";
import { ConfigService } from "@nestjs/config";

export type GeminiThinkingLevelConfigKey =
  | "GEMINI_ANALYZER_THINKING_LEVEL"
  | "GEMINI_FACT_CHECK_GROUNDING_THINKING_LEVEL"
  | "GEMINI_FACT_CHECK_SYNTHESIS_THINKING_LEVEL"
  | "GEMINI_JUDGE_THINKING_LEVEL";

export function getGeminiThinkingLevel(
  configService: ConfigService,
  key: GeminiThinkingLevelConfigKey,
): ThinkingLevel {
  const value = configService.get<string>(key, "MEDIUM").toUpperCase();

  switch (value) {
    case "LOW":
      return ThinkingLevel.LOW;
    case "MEDIUM":
      return ThinkingLevel.MEDIUM;
    case "HIGH":
      return ThinkingLevel.HIGH;
    default:
      throw new Error(`Unsupported Gemini thinking level: ${key}=${value}.`);
  }
}
