import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_CLIENT } from "../ai/gemini/gemini.constants";
import { GeminiConfigurationError } from "../ai/gemini/gemini.errors";
import { parseRequiredJson } from "../ai/gemini/gemini-response.util";
import { FACT_CHECK_BATCH_RESPONSE_SCHEMA } from "../ai/schemas/fact-check-batch.schema";
import {
  DEFAULT_MAX_FACT_CHECK_REASON_LENGTH,
  DEFAULT_MAX_FACT_CHECK_SOURCES_PER_RESULT,
} from "./constants";
import {
  FactCheckBatchInput,
  FactCheckBatchOutput,
  GroundedEvidenceBundle,
} from "./dto/fact-check-batch.dto";
import { extractGroundedEvidence } from "./grounding-source.extractor";
import { validateFactCheckBatchOutput } from "./validators/fact-check-batch-output.validator";
import { withAbortableTimeout } from "../ai/gemini/gemini-timeout.util";

const FACT_CHECK_GROUNDING_SYSTEM_INSTRUCTION = [
  "You are a fact checker for debate argument components.",
  "Use Google Search grounding to collect evidence for each target independently.",
  "Prefer official statistics, public institutions, academic sources, primary documents, and reputable original reporting.",
  "Do not force a definitive verdict when evidence is insufficient, not verifiable, or time-sensitive.",
  "Include each componentId in the evidence discussion.",
].join("\n");

const FACT_CHECK_SYNTHESIS_SYSTEM_INSTRUCTION = [
  "You convert grounded evidence into a strict JSON fact-check batch result.",
  "Return JSON only. Do not include markdown, commentary, or code fences.",
  "Return exactly one result for every input target.",
  "Use only the provided sourceIndexes. Never invent URLs or cite sources outside the provided source list.",
  "Use INSUFFICIENT_EVIDENCE, NOT_VERIFIABLE, or OUTDATED_OR_TIME_SENSITIVE when the evidence does not support a stronger status.",
].join("\n");

@Injectable()
export class FactCheckerAiService {
  constructor(
    @Inject(GEMINI_CLIENT)
    private readonly gemini: GoogleGenAI,
    private readonly configService: ConfigService,
  ) {}

  async check(
    input: FactCheckBatchInput,
    abortSignal?: AbortSignal,
  ): Promise<{
    output: FactCheckBatchOutput;
    groundedEvidence: GroundedEvidenceBundle;
  }> {
    assertGeminiApiKey(this.configService);

    const model = this.configService.getOrThrow<string>(
      "GEMINI_FACT_CHECKER_MODEL",
    );
    const maxRetries = this.configService.get<number>(
      "GEMINI_FACT_CHECKER_MAX_RETRIES",
      1,
    );
    const timeoutMs = this.configService.get<number>(
      "GEMINI_REQUEST_TIMEOUT_MS",
      60000,
    );
    const maxSourcesPerResult = this.configService.get<number>(
      "FACT_CHECK_MAX_SOURCES_PER_RESULT",
      DEFAULT_MAX_FACT_CHECK_SOURCES_PER_RESULT,
    );
    const maxReasonLength = this.configService.get<number>(
      "FACT_CHECK_MAX_REASON_LENGTH",
      DEFAULT_MAX_FACT_CHECK_REASON_LENGTH,
    );

    const groundedEvidence = await this.generateGroundedEvidenceWithRetry(
      model,
      input,
      maxRetries,
      timeoutMs,
      maxSourcesPerResult * input.targets.length,
      abortSignal,
    );
    const output = await this.generateStructuredOutputWithRetry(
      model,
      input,
      groundedEvidence,
      maxRetries,
      timeoutMs,
      abortSignal,
    );

    validateFactCheckBatchOutput(input, output, groundedEvidence, {
      maxReasonLength,
      maxSourcesPerResult,
    });

    return { output, groundedEvidence };
  }

  private async generateGroundedEvidenceWithRetry(
    model: string,
    input: FactCheckBatchInput,
    maxRetries: number,
    timeoutMs: number,
    maxSources: number,
    abortSignal?: AbortSignal,
  ): Promise<GroundedEvidenceBundle> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await withAbortableTimeout(
          (signal) =>
            this.generateGroundedEvidence(model, input, maxSources, signal),
          timeoutMs,
          "Gemini fact checker grounding request timed out.",
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

  private async generateStructuredOutputWithRetry(
    model: string,
    input: FactCheckBatchInput,
    groundedEvidence: GroundedEvidenceBundle,
    maxRetries: number,
    timeoutMs: number,
    abortSignal?: AbortSignal,
  ): Promise<FactCheckBatchOutput> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await withAbortableTimeout(
          (signal) =>
            this.generateStructuredOutput(
              model,
              input,
              groundedEvidence,
              signal,
            ),
          timeoutMs,
          "Gemini fact checker synthesis request timed out.",
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

  private async generateGroundedEvidence(
    model: string,
    input: FactCheckBatchInput,
    maxSources: number,
    abortSignal?: AbortSignal,
  ): Promise<GroundedEvidenceBundle> {
    const response = await this.gemini.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildGroundingPrompt(input),
            },
          ],
        },
      ],
      config: {
        abortSignal,
        systemInstruction: FACT_CHECK_GROUNDING_SYSTEM_INSTRUCTION,
        tools: [{ googleSearch: {} }],
        temperature: 0.1,
      },
    });

    return extractGroundedEvidence(response, maxSources);
  }

  private async generateStructuredOutput(
    model: string,
    input: FactCheckBatchInput,
    groundedEvidence: GroundedEvidenceBundle,
    abortSignal?: AbortSignal,
  ): Promise<FactCheckBatchOutput> {
    const response = await this.gemini.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildStructuredSynthesisPrompt(input, groundedEvidence),
            },
          ],
        },
      ],
      config: {
        abortSignal,
        systemInstruction: FACT_CHECK_SYNTHESIS_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: FACT_CHECK_BATCH_RESPONSE_SCHEMA,
        temperature: 0,
      },
    });

    return parseRequiredJson<FactCheckBatchOutput>(response.text);
  }
}

function buildGroundingPrompt(input: FactCheckBatchInput): string {
  return JSON.stringify({
    task: "Collect grounded evidence for each fact-check target.",
    debate: input.debate,
    turn: input.turn,
    targets: input.targets,
    allowedStatuses: [
      "SUPPORTED",
      "CONTRADICTED",
      "PARTIALLY_SUPPORTED",
      "INSUFFICIENT_EVIDENCE",
      "NOT_VERIFIABLE",
      "OUTDATED_OR_TIME_SENSITIVE",
    ],
  });
}

function buildStructuredSynthesisPrompt(
  input: FactCheckBatchInput,
  groundedEvidence: GroundedEvidenceBundle,
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
