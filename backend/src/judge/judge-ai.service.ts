import { Inject, Injectable, Logger } from "@nestjs/common";
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
import { getGeminiThinkingLevel } from "../ai/gemini/gemini-thinking-level.util";

const JUDGE_SYSTEM_INSTRUCTION = [
  "You evaluate a completed debate using its argument graph and fact-check results.",
  "Return JSON only. Do not include markdown, commentary, or code fences.",
  "Score argumentation from 0 to 40, interaction from 0 to 30, and factual reliability from 0 to 30 for each side.",
  "Apply fact-check statuses consistently when scoring factual reliability: SUPPORTED is positive evidence, CONTRADICTED is a strong negative, and PARTIALLY_SUPPORTED is a limited negative relative to full support.",
  "INSUFFICIENT_EVIDENCE means no reliable verdict was possible and NOT_VERIFIABLE means the claim was not empirically checkable; do not treat either as false automatically, but consider whether the speaker presented unsupported certainty as fact.",
  "OUTDATED means a time-specific claim was no longer valid at the debate's reference time; penalize according to its importance to the argument and do not double-penalize it as CONTRADICTED.",
  "Do not penalize opinions, value judgments, or purely logical claims merely because they have no fact-check result.",
  "Do not return totalScore, winner, or any fields outside the schema.",
  "The sideA* and sideB* JSON field names are internal schema keys only.",
  "In overallReason, sideAFeedback, and sideBFeedback, refer to each speaker by the exact debate.sideASpeakerDisplayName or debate.sideBSpeakerDisplayName.",
  "Never call a speaker SIDE_A, SIDE_B, Side A, Side B, 측면 A, or 측면 B in prose.",
].join("\n");

@Injectable()
export class JudgeAiService {
  private readonly logger = new Logger(JudgeAiService.name);

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
    const timeoutMs =
      this.configService.get<number>("GEMINI_JUDGE_TIMEOUT_MS") ??
      this.configService.get<number>("GEMINI_REQUEST_TIMEOUT_MS", 40000);
    const output = await withAbortableTimeout(
      (signal) => this.generate(model, input, signal),
      timeoutMs,
      "Gemini judge request timed out.",
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

  private async generate(
    model: string,
    input: JudgeInput,
    abortSignal?: AbortSignal,
  ): Promise<JudgeOutput> {
    const startedAt = Date.now();
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
        thinkingConfig: {
          thinkingLevel: getGeminiThinkingLevel(
            this.configService,
            "GEMINI_JUDGE_THINKING_LEVEL",
          ),
        },
      },
    });

    const usage = response.usageMetadata;
    this.logger.log(
      [
        "Gemini judge request completed.",
        `debateId=${input.debate.id}`,
        `durationMs=${Date.now() - startedAt}`,
        `inputTokens=${usage?.promptTokenCount ?? "unknown"}`,
        `cachedTokens=${usage?.cachedContentTokenCount ?? 0}`,
        `outputTokens=${usage?.candidatesTokenCount ?? "unknown"}`,
        `thinkingTokens=${usage?.thoughtsTokenCount ?? "unknown"}`,
        `totalTokens=${usage?.totalTokenCount ?? "unknown"}`,
      ].join(" "),
    );

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
