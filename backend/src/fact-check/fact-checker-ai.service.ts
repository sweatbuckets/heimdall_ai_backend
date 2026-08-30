import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_CLIENT } from "../ai/gemini/gemini.constants";
import { GeminiConfigurationError } from "../ai/gemini/gemini.errors";
import { parseRequiredJson } from "../ai/gemini/gemini-response.util";
import { FACT_CHECK_BATCH_RESPONSE_SCHEMA } from "../ai/schemas/fact-check-batch.schema";
import {
  DEFAULT_MAX_FACT_CHECK_GROUNDING_SOURCES,
  DEFAULT_MAX_FACT_CHECK_SOURCES_PER_RESULT,
} from "./constants";
import {
  FactCheckBatchInput,
  FactCheckBatchOutput,
  GroundedEvidenceBundle,
} from "./dto/fact-check-batch.dto";
import { extractGroundedEvidence } from "./grounding-source.extractor";
import { withAbortableTimeout } from "../ai/gemini/gemini-timeout.util";
import { getGeminiThinkingLevel } from "../ai/gemini/gemini-thinking-level.util";

const FACT_CHECK_GROUNDING_SYSTEM_INSTRUCTION = [
  "You are a fact checker for debate argument components.",
  "Use Google Search grounding to collect evidence for each target independently.",
  "Keep the final grounded source set to at most five distinct sources.",
  "Prefer official statistics, public institutions, academic sources, primary documents, and reputable original reporting.",
  "For time-sensitive claims, verify them against the debate's reference time and distinguish an actually outdated claim from one that merely changes over time.",
  "Do not force a definitive verdict when evidence is insufficient or the claim is not verifiable.",
  "Include each componentId in the evidence discussion.",
].join("\n");

const FACT_CHECK_SYNTHESIS_SYSTEM_INSTRUCTION = [
  "You convert grounded evidence into a strict JSON fact-check batch result.",
  "Return JSON only. Do not include markdown, commentary, or code fences.",
  "Return exactly one result for every input target.",
  "Use only the provided sourceIndexes. Never invent URLs or cite sources outside the provided source list.",
  "Return no more sourceIndexes per result than the maxSourceIndexesPerResult value in outputRules.",
  "Choose exactly one mutually exclusive status for each target.",
  "Use SUPPORTED only when reliable evidence supports the full material claim.",
  "Use CONTRADICTED when reliable evidence refutes the material claim.",
  "Use PARTIALLY_SUPPORTED only when reliable evidence supports at least one material part and refutes at least one other material part; missing evidence alone is not partial support.",
  "Use INSUFFICIENT_EVIDENCE when the claim is verifiable but the available evidence is missing, too weak, or conflicting, so support or contradiction cannot be determined.",
  "Use NOT_VERIFIABLE when the claim itself cannot be empirically checked, such as a value judgment, prediction, private assertion, or materially vague statement.",
  "Use OUTDATED when the claim depended on a past time-specific fact that is no longer valid at the debate's reference time; prefer it over CONTRADICTED when staleness is the reason the claim is wrong.",
].join("\n");

@Injectable()
export class FactCheckerAiService {
  private readonly logger = new Logger(FactCheckerAiService.name);

  constructor(
    @Inject(GEMINI_CLIENT)
    private readonly gemini: GoogleGenAI,
    private readonly configService: ConfigService,
  ) {}

  async ground(
    input: FactCheckBatchInput,
    abortSignal?: AbortSignal,
  ): Promise<GroundedEvidenceBundle> {
    assertGeminiApiKey(this.configService);

    const model = this.configService.getOrThrow<string>(
      "GEMINI_FACT_CHECKER_MODEL",
    );
    const legacyTimeoutMs = this.configService.get<number>(
      "GEMINI_REQUEST_TIMEOUT_MS",
      90000,
    );
    const groundingTimeoutMs =
      this.configService.get<number>(
        "GEMINI_FACT_CHECK_GROUNDING_TIMEOUT_MS",
      ) ?? legacyTimeoutMs;
    const maxGroundingSources = this.configService.get<number>(
      "FACT_CHECK_MAX_SOURCES_PER_GROUNDING",
      DEFAULT_MAX_FACT_CHECK_GROUNDING_SOURCES,
    );

    return withAbortableTimeout(
      (signal) =>
        this.generateGroundedEvidence(
          model,
          input,
          maxGroundingSources,
          signal,
        ),
      groundingTimeoutMs,
      "Gemini fact checker grounding request timed out.",
      abortSignal,
    );
  }

  async synthesize(
    input: FactCheckBatchInput,
    groundedEvidence: GroundedEvidenceBundle,
    abortSignal?: AbortSignal,
  ): Promise<FactCheckBatchOutput> {
    assertGeminiApiKey(this.configService);

    const model = this.configService.getOrThrow<string>(
      "GEMINI_FACT_CHECKER_MODEL",
    );
    const synthesisTimeoutMs =
      this.configService.get<number>(
        "GEMINI_FACT_CHECK_SYNTHESIS_TIMEOUT_MS",
      ) ?? 70000;
    const maxSourcesPerResult = this.configService.get<number>(
      "FACT_CHECK_MAX_SOURCES_PER_RESULT",
      DEFAULT_MAX_FACT_CHECK_SOURCES_PER_RESULT,
    );

    return withAbortableTimeout(
      (signal) =>
        this.generateStructuredOutput(
          model,
          input,
          groundedEvidence,
          maxSourcesPerResult,
          signal,
        ),
      synthesisTimeoutMs,
      "Gemini fact checker synthesis request timed out.",
      abortSignal,
    );
  }

  private async generateGroundedEvidence(
    model: string,
    input: FactCheckBatchInput,
    maxSources: number,
    abortSignal?: AbortSignal,
  ): Promise<GroundedEvidenceBundle> {
    const startedAt = Date.now();
    const response = await this.gemini.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildGroundingPrompt(input, maxSources),
            },
          ],
        },
      ],
      config: {
        abortSignal,
        systemInstruction: FACT_CHECK_GROUNDING_SYSTEM_INSTRUCTION,
        tools: [{ googleSearch: {} }],
        thinkingConfig: {
          thinkingLevel: getGeminiThinkingLevel(
            this.configService,
            "GEMINI_FACT_CHECK_GROUNDING_THINKING_LEVEL",
          ),
        },
      },
    });

    this.logUsage("GROUNDING", input, response.usageMetadata, startedAt);

    return extractGroundedEvidence(response, maxSources);
  }

  private async generateStructuredOutput(
    model: string,
    input: FactCheckBatchInput,
    groundedEvidence: GroundedEvidenceBundle,
    maxSourcesPerResult: number,
    abortSignal?: AbortSignal,
  ): Promise<FactCheckBatchOutput> {
    const startedAt = Date.now();
    const response = await this.gemini.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildStructuredSynthesisPrompt(
                input,
                groundedEvidence,
                maxSourcesPerResult,
              ),
            },
          ],
        },
      ],
      config: {
        abortSignal,
        systemInstruction: FACT_CHECK_SYNTHESIS_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: FACT_CHECK_BATCH_RESPONSE_SCHEMA,
        thinkingConfig: {
          thinkingLevel: getGeminiThinkingLevel(
            this.configService,
            "GEMINI_FACT_CHECK_SYNTHESIS_THINKING_LEVEL",
          ),
        },
      },
    });

    this.logUsage("SYNTHESIS", input, response.usageMetadata, startedAt);

    return parseRequiredJson<FactCheckBatchOutput>(response.text);
  }

  private logUsage(
    stage: "GROUNDING" | "SYNTHESIS",
    input: FactCheckBatchInput,
    usage:
      | {
          promptTokenCount?: number;
          cachedContentTokenCount?: number;
          candidatesTokenCount?: number;
          thoughtsTokenCount?: number;
          totalTokenCount?: number;
        }
      | undefined,
    startedAt: number,
  ): void {
    this.logger.log(
      [
        "Gemini fact-check request completed.",
        `stage=${stage}`,
        `debateId=${input.debate.id}`,
        `phase=${input.round.phase}`,
        `round=${input.round.number}`,
        `targets=${input.targets.length}`,
        `durationMs=${Date.now() - startedAt}`,
        `inputTokens=${usage?.promptTokenCount ?? "unknown"}`,
        `cachedTokens=${usage?.cachedContentTokenCount ?? 0}`,
        `outputTokens=${usage?.candidatesTokenCount ?? "unknown"}`,
        `thinkingTokens=${usage?.thoughtsTokenCount ?? "unknown"}`,
        `totalTokens=${usage?.totalTokenCount ?? "unknown"}`,
      ].join(" "),
    );
  }
}

function buildGroundingPrompt(
  input: FactCheckBatchInput,
  maxSources: number,
): string {
  return JSON.stringify({
    task: "Collect grounded evidence for each fact-check target.",
    searchRules: {
      maxDistinctSources: maxSources,
      stopSearchingAfterLimit: true,
      instruction: `Once ${maxSources} distinct usable sources have been found, stop searching and do not collect additional sources.`,
    },
    debate: input.debate,
    round: input.round,
    targets: input.targets,
    allowedStatuses: [
      "SUPPORTED",
      "CONTRADICTED",
      "PARTIALLY_SUPPORTED",
      "INSUFFICIENT_EVIDENCE",
      "NOT_VERIFIABLE",
      "OUTDATED",
    ],
  });
}

function buildStructuredSynthesisPrompt(
  input: FactCheckBatchInput,
  groundedEvidence: GroundedEvidenceBundle,
  maxSourcesPerResult: number,
): string {
  return JSON.stringify({
    task: "Synthesize the grounded evidence into FactCheckBatchOutput.",
    input,
    evidenceText: groundedEvidence.evidenceText,
    webSearchQueries: groundedEvidence.webSearchQueries,
    sources: groundedEvidence.sources.map((source) => ({
      sourceIndex: source.sourceIndex,
      title: source.title,
      publisher: source.publisher,
      url: source.url,
    })),
    outputRules: {
      oneResultPerTarget: true,
      useSourceIndexesOnly: true,
      maxSourceIndexesPerResult: maxSourcesPerResult,
      doNotReturnUrls: true,
    },
  });
}

function assertGeminiApiKey(configService: ConfigService): void {
  if (!configService.get<string>("GEMINI_API_KEY")) {
    throw new GeminiConfigurationError(
      "GEMINI_API_KEY is required for Fact Checker AI calls.",
    );
  }
}
