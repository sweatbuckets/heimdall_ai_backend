import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_CLIENT } from "../ai/gemini/gemini.constants";
import { GeminiConfigurationError } from "../ai/gemini/gemini.errors";
import { parseRequiredJson } from "../ai/gemini/gemini-response.util";
import { ANALYZE_TURN_RESPONSE_SCHEMA } from "../ai/schemas/analyze-turn.schema";
import { AnalyzeTurnInput, AnalyzeTurnOutput } from "./dto/analyze-turn.dto";
import { validateAnalyzeTurnOutput } from "./validators/analyze-turn-output.validator";
import { withAbortableTimeout } from "../ai/gemini/gemini-timeout.util";
import { getGeminiThinkingLevel } from "../ai/gemini/gemini-thinking-level.util";
import { EMPTY_DEBATE_TURN_CONTENT } from "../debates/debate-turn-content.constants";

const ANALYZER_SYSTEM_INSTRUCTION = [
  "You are a debate argument graph analyzer.",
  "Analyze only dynamicRequest.currentTurns[].content as the source of NEW components.",
  "dynamicRequest.currentTurns contains both speakers' turns for one debate round in sequence order.",
  "Use accumulatedGraph only as context and as possible EXISTING relation targets.",
  "Do not summarize the whole debate.",
  "Do not invent claims that are not present in the current round.",
  "Return JSON only. Do not include markdown, commentary, or code fences.",
  "",
  "Component extraction rules:",
  "- Set turnId to the exact dynamicRequest.currentTurns[].id that contains the source statement.",
  "- Every NEW component must belong to exactly one current turn.",
  `- If a turn's trimmed content is exactly \"${EMPTY_DEBATE_TURN_CONTENT}\", create no components, relations, or fact-check targets for that turn. Continue analyzing the other turn normally.`,
  "- Do not expect the user to explicitly label or format a Major Claim.",
  "- In OPENING phase, infer at most one Major Claim only when the content expresses a clear central position about debate.topic.",
  "- Do not create a Major Claim from a greeting, filler, small talk, a mere topic mention, or content without a clear position.",
  "- Each Major Claim should be a concise proposition derived from its dynamicRequest.currentTurns[].content and debate.topic.",
  "- Do not create a Major Claim outside OPENING phase.",
  "- If either current speaker already has a Major Claim in accumulatedGraph, do not create another Major Claim for that speaker.",
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
  `- 내용이 정확히 '${EMPTY_DEBATE_TURN_CONTENT}'이면 해당 턴에서는 컴포넌트, 관계, 팩트체크 대상을 만들지 않는다.`,
  "- OPENING에서는 사용자가 Major Claim 형식을 직접 작성할 것으로 가정하지 않는다.",
  "- OPENING 내용에 debate.topic에 대한 명확한 핵심 입장이 표현된 경우에만 최대 하나의 Major Claim으로 추출한다.",
  "- 인사, 잡담, 단순 주제 언급처럼 명확한 입장이 없으면 Major Claim을 만들지 않는다.",
  "- '근거', '이유', '왜냐하면', '예를 들어', '따라서'처럼 다른 명제를 뒷받침하거나 정당화하는 의도는 SUPPORTS 관계 후보로 본다.",
  "- '반박', '하지만', '그러나', '그건 아니다', '동의하기 어렵다'처럼 다른 명제를 약화, 부정, 반례 제시, 문제 제기하는 의도는 ATTACKS 관계 후보로 본다.",
  "- '정말인가?', '근거가 무엇인가?', '어떻게 설명하는가?'처럼 증거, 설명, 명확화, 정당화를 요구하는 의도는 QUESTIONS 관계 후보로 본다.",
  "- '방금 질문에 답하면', '그 이유는', '이에 대한 답은'처럼 이전 질문이나 문제 제기에 응답하는 의도는 ANSWERS 관계 후보로 본다.",
  "- '사실 검증 대상'은 외부 자료로 참/거짓/부분참/근거불충분을 판단할 수 있는 문장이다.",
  "- 한국어 발언의 의미를 보존하되, statement는 짧고 명확한 한국어 명제문으로 정리한다.",
].join("\n");

@Injectable()
export class AnalyzerAiService {
  private readonly logger = new Logger(AnalyzerAiService.name);

  constructor(
    @Inject(GEMINI_CLIENT)
    private readonly gemini: GoogleGenAI,
    private readonly configService: ConfigService,
  ) {}

  async analyze(
    input: AnalyzeTurnInput,
    abortSignal?: AbortSignal,
  ): Promise<AnalyzeTurnOutput> {
    assertGeminiApiKey(this.configService);

    const model = this.configService.getOrThrow<string>(
      "GEMINI_ANALYZER_MODEL",
    );
    const timeoutMs =
      this.configService.get<number>("GEMINI_ANALYZER_TIMEOUT_MS") ??
      this.configService.get<number>("GEMINI_REQUEST_TIMEOUT_MS", 60000);

    const output = await this.generateOnce(
      model,
      input,
      timeoutMs,
      abortSignal,
    );
    validateAnalyzeTurnOutput(input, output);

    return output;
  }

  private async generateOnce(
    model: string,
    input: AnalyzeTurnInput,
    timeoutMs: number,
    abortSignal?: AbortSignal,
  ): Promise<AnalyzeTurnOutput> {
    const startedAt = Date.now();
    try {
      const result = await withAbortableTimeout(
        (signal) => this.generate(model, input, signal),
        timeoutMs,
        "Gemini analyzer request timed out.",
        abortSignal,
      );
      const usage = result.usageMetadata;
      this.logger.log(
        [
          "Gemini analyzer request completed.",
          `debateId=${input.debate.id}`,
          `turnIds=${input.currentTurns.map((turn) => turn.id).join(",")}`,
          `phase=${input.currentTurns[0]?.phase ?? "UNKNOWN"}`,
          `round=${input.currentTurns[0]?.round ?? "UNKNOWN"}`,
          `durationMs=${Date.now() - startedAt}`,
          `inputTokens=${usage?.promptTokenCount ?? "unknown"}`,
          `cachedTokens=${usage?.cachedContentTokenCount ?? 0}`,
          `outputTokens=${usage?.candidatesTokenCount ?? "unknown"}`,
          `thinkingTokens=${usage?.thoughtsTokenCount ?? "unknown"}`,
          `totalTokens=${usage?.totalTokenCount ?? "unknown"}`,
        ].join(" "),
      );
      return parseRequiredJson<AnalyzeTurnOutput>(result.text);
    } catch (error) {
      this.logger.warn(
        [
          "Gemini analyzer request failed.",
          `debateId=${input.debate.id}`,
          `turnIds=${input.currentTurns.map((turn) => turn.id).join(",")}`,
          `durationMs=${Date.now() - startedAt}`,
          `error=${error instanceof Error ? error.message : String(error)}`,
        ].join(" "),
      );
      throw error;
    }
  }

  private async generate(
    model: string,
    input: AnalyzeTurnInput,
    abortSignal?: AbortSignal,
  ) {
    const response = await this.gemini.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: serializeAnalyzerPrompt(input),
            },
          ],
        },
      ],
      config: {
        abortSignal,
        systemInstruction: ANALYZER_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: ANALYZE_TURN_RESPONSE_SCHEMA,
        thinkingConfig: {
          thinkingLevel: getGeminiThinkingLevel(
            this.configService,
            "GEMINI_ANALYZER_THINKING_LEVEL",
          ),
        },
      },
    });

    return response;
  }
}

function serializeAnalyzerPrompt(input: AnalyzeTurnInput): string {
  const phase = input.currentTurns[0]?.phase ?? null;
  const round = input.currentTurns[0]?.round ?? null;

  return JSON.stringify({
    debate: input.debate,
    accumulatedGraph: input.accumulatedGraph,
    dynamicRequest: {
      phase,
      round,
      currentTurns: input.currentTurns,
    },
  });
}

function assertGeminiApiKey(configService: ConfigService): void {
  if (!configService.get<string>("GEMINI_API_KEY")) {
    throw new GeminiConfigurationError(
      "GEMINI_API_KEY is required for Analyzer AI calls.",
    );
  }
}
