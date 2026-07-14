import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_CLIENT } from "../ai/gemini/gemini.constants";
import { GeminiConfigurationError } from "../ai/gemini/gemini.errors";
import { parseRequiredJson } from "../ai/gemini/gemini-response.util";
import { ANALYZE_TURN_RESPONSE_SCHEMA } from "../ai/schemas/analyze-turn.schema";
import { AnalyzeTurnInput, AnalyzeTurnOutput } from "./dto/analyze-turn.dto";
import { validateAnalyzeTurnOutput } from "./validators/analyze-turn-output.validator";

const ANALYZER_SYSTEM_INSTRUCTION = [
  "You are a debate argument graph analyzer.",
  "Analyze only currentTurn.content as the source of NEW components.",
  "Use accumulatedGraph only as context and as possible EXISTING relation targets.",
  "Do not summarize the whole debate.",
  "Do not invent claims that are not present in the current turn.",
  "Return JSON only. Do not include markdown, commentary, or code fences.",
  "",
  "Component extraction rules:",
  "- In OPENING phase, identify the speaker's central position about debate.topic and create exactly one Major Claim unless the current speaker already has one in accumulatedGraph.",
  "- The OPENING Major Claim should be the first new component, using localKey NEW_1.",
  "- The Major Claim should be a concise proposition derived from currentTurn.content and debate.topic.",
  "- Do not create a Major Claim outside OPENING phase.",
  "- If the current speaker already has a Major Claim in accumulatedGraph, do not create another Major Claim.",
  "- Extract supporting components for reasons, evidence, explanations, examples, or causal arguments.",
  "- Extract rebuttal components for objections, challenges, refutations, or counterexamples.",
  "- Keep each statement concise and meaningful as a standalone proposition.",
  "- Avoid over-splitting one sentence into many tiny components.",
  "- Avoid merging unrelated claims into one component.",
  "",
  "Fact-check rules:",
  "- Set requiresFactCheck=true only for claims that can be checked against external evidence.",
  "- Examples include statistics, historical events, legal rules, scientific facts, public records, named organizations, dates, prices, and measurable outcomes.",
  "- Do not mark opinions, preferences, moral judgments, predictions without evidence, or purely logical relations as fact-check targets.",
  "",
  "Relation rules:",
  "- Argumental SUPPORTS means the NEW component gives a reason for another claim.",
  "- Argumental ATTACKS means the NEW component challenges, weakens, or contradicts another claim.",
  "- Interactional QUESTIONS means the NEW component asks about, requests evidence for, or challenges clarification of another claim.",
  "- Interactional ANSWERS means the NEW component responds to a previous question or challenge.",
  "Use localKey values exactly like NEW_1, NEW_2, NEW_3.",
  "Do not duplicate localKey values.",
  "Only create relations from NEW components to NEW or EXISTING components.",
  "Never create EXISTING to NEW or EXISTING to EXISTING relations.",
  "Never create self-referencing relations.",
  "Do not create duplicate relations.",
  "Do not create both SUPPORTS and ATTACKS for the same from/to pair.",
  "Do not create both QUESTIONS and ANSWERS for the same from/to pair.",
  "Do not force a relation when the relation is unclear.",
  "A non-major component may remain without a relation if it is a meaningful standalone claim, reason, example, or fact-checkable statement.",
  "Omit fragments, filler, rhetorical padding, or statements with no argumentative value.",
  "",
  "Korean debate interpretation notes:",
  "- The Korean expressions below are strong semantic signals, not exhaustive keyword lists.",
  "- Classify any sentence with the same discourse intent the same way, even if it does not use the exact listed words.",
  "- OPENING에서는 debate.topic에 대한 발언자의 핵심 입장을 먼저 하나의 Major Claim으로 정리한다.",
  "- '근거', '이유', '왜냐하면', '예를 들어', '따라서'처럼 다른 명제를 뒷받침하거나 정당화하는 의도는 SUPPORTS 관계 후보로 본다.",
  "- '반박', '하지만', '그러나', '그건 아니다', '동의하기 어렵다'처럼 다른 명제를 약화, 부정, 반례 제시, 문제 제기하는 의도는 ATTACKS 관계 후보로 본다.",
  "- '정말인가?', '근거가 무엇인가?', '어떻게 설명하는가?'처럼 증거, 설명, 명확화, 정당화를 요구하는 의도는 QUESTIONS 관계 후보로 본다.",
  "- '방금 질문에 답하면', '그 이유는', '이에 대한 답은'처럼 이전 질문이나 문제 제기에 응답하는 의도는 ANSWERS 관계 후보로 본다.",
  "- '사실 검증 대상'은 외부 자료로 참/거짓/부분참/근거불충분을 판단할 수 있는 문장이다.",
  "- 한국어 발언의 의미를 보존하되, statement는 짧고 명확한 한국어 명제문으로 정리한다.",
].join("\n");

@Injectable()
export class AnalyzerAiService {
  constructor(
    @Inject(GEMINI_CLIENT)
    private readonly gemini: GoogleGenAI,
    private readonly configService: ConfigService,
  ) {}

  async analyze(input: AnalyzeTurnInput): Promise<AnalyzeTurnOutput> {
    assertGeminiApiKey(this.configService);

    const model = this.configService.getOrThrow<string>(
      "GEMINI_ANALYZER_MODEL",
    );
    const maxRetries = this.configService.get<number>("GEMINI_MAX_RETRIES", 3);
    const timeoutMs = this.configService.get<number>(
      "GEMINI_REQUEST_TIMEOUT_MS",
      60000,
    );

    const output = await this.generateWithRetry(
      model,
      input,
      maxRetries,
      timeoutMs,
    );
    validateAnalyzeTurnOutput(input, output);

    return output;
  }

  private async generateWithRetry(
    model: string,
    input: AnalyzeTurnInput,
    maxRetries: number,
    timeoutMs: number,
  ): Promise<AnalyzeTurnOutput> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await withTimeout(
          this.generate(model, input),
          timeoutMs,
          "Gemini analyzer request timed out.",
        );
      } catch (error) {
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
    input: AnalyzeTurnInput,
  ): Promise<AnalyzeTurnOutput> {
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
        systemInstruction: ANALYZER_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: ANALYZE_TURN_RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    });

    return parseRequiredJson<AnalyzeTurnOutput>(response.text);
  }
}

function assertGeminiApiKey(configService: ConfigService): void {
  if (!configService.get<string>("GEMINI_API_KEY")) {
    throw new GeminiConfigurationError(
      "GEMINI_API_KEY is required for Analyzer AI calls.",
    );
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
