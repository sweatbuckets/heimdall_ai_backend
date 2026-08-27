import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_CLIENT } from "../ai/gemini/gemini.constants";
import { GeminiConfigurationError } from "../ai/gemini/gemini.errors";
import { parseRequiredJson } from "../ai/gemini/gemini-response.util";
import { JUDGE_RESPONSE_SCHEMA } from "../ai/schemas/judge.schema";
import {
  DEFAULT_MAX_JUDGE_FEEDBACK_LENGTH,
  DEFAULT_MAX_JUDGE_OVERALL_REASON_LENGTH,
} from "./constants";
import { JudgeInput, JudgeOutput } from "./dto/judge.dto";
import { validateJudgeOutput } from "./validators/judge-output.validator";
import { withAbortableTimeout } from "../ai/gemini/gemini-timeout.util";

const JUDGE_SYSTEM_INSTRUCTION = [
  "You evaluate a completed debate using its argument graph and fact-check results.",
  "Return JSON only. Do not include markdown, commentary, or code fences.",
  "Score argumentation from 0 to 40, interaction from 0 to 30, and factual reliability from 0 to 30 for each side.",
  "Do not return totalScore, winner, or any fields outside the schema.",
  "Use SIDE_A and SIDE_B consistently.",
].join("\n");

@Injectable()
export class JudgeAiService {
  constructor(
    @Inject(GEMINI_CLIENT)
    private readonly gemini: GoogleGenAI,
    private readonly configService: ConfigService,
  ) {}

  async judge(
    input: JudgeInput,
    abortSignal?: AbortSignal,
  ): Promise<JudgeOutput> {
    assertGeminiApiKey(this.configService);

    const model = this.configService.getOrThrow<string>("GEMINI_JUDGE_MODEL");
    const maxRetries = this.configService.get<number>(
      "GEMINI_JUDGE_MAX_RETRIES",
      3,
    );
    const timeoutMs = this.configService.get<number>(
      "GEMINI_REQUEST_TIMEOUT_MS",
      60000,
    );
    const output = await this.generateWithRetry(
      model,
      input,
      maxRetries,
      timeoutMs,
      abortSignal,
    );

    validateJudgeOutput(output, {
      maxOverallReasonLength: this.configService.get<number>(
        "JUDGE_MAX_OVERALL_REASON_LENGTH",
        DEFAULT_MAX_JUDGE_OVERALL_REASON_LENGTH,
      ),
      maxFeedbackLength: this.configService.get<number>(
        "JUDGE_MAX_FEEDBACK_LENGTH",
        DEFAULT_MAX_JUDGE_FEEDBACK_LENGTH,
      ),
    });

    return output;
  }

  private async generateWithRetry(
    model: string,
    input: JudgeInput,
    maxRetries: number,
    timeoutMs: number,
    abortSignal?: AbortSignal,
  ): Promise<JudgeOutput> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await withAbortableTimeout(
          (signal) => this.generate(model, input, signal),
          timeoutMs,
          "Gemini judge request timed out.",
          abortSignal,
        );
      } catch (error) {
        if (abortSignal?.aborted) throw error;
        lastError = error;

        if (attempt === maxRetries) {
          break;
        }
      }
    }

    throw lastError;
  }

  private async generate(
    model: string,
    input: JudgeInput,
    abortSignal?: AbortSignal,
  ): Promise<JudgeOutput> {
    const response = await this.gemini.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: JSON.stringify(input),
            },
          ],
        },
      ],
      config: {
        abortSignal,
        systemInstruction: JUDGE_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: JUDGE_RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    });

    return parseRequiredJson<JudgeOutput>(response.text);
  }
}

function assertGeminiApiKey(configService: ConfigService): void {
  if (!configService.get<string>("GEMINI_API_KEY")) {
    throw new GeminiConfigurationError(
      "GEMINI_API_KEY is required for Judge AI calls.",
    );
  }
}
