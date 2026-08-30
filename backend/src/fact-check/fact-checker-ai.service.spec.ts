import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import { FactCheckerAiService } from "./fact-checker-ai.service";
import { FactCheckBatchInput } from "./dto/fact-check-batch.dto";
import { DebatePhase, DebateSide } from "../debates/domain/debate.enums";
import { Logger } from "@nestjs/common";

describe("FactCheckerAiService timeouts", () => {
  const input: FactCheckBatchInput = {
    debate: { id: "debate-1", topic: "Topic" },
    round: { phase: DebatePhase.OPENING, number: 1 },
    targets: [
      {
        componentId: "component-1",
        statement: "A factual claim",
        turnId: "turn-1",
        sequence: 1,
        speakerSide: DebateSide.SIDE_A,
      },
    ],
  };

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("aborts the grounding request when the request timeout expires", async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const generateContent = jest.fn().mockImplementation((request) => {
      requestSignal = request.config.abortSignal;
      return new Promise(() => undefined);
    });
    const service = createService(generateContent);

    const result = service.ground(input);
    expect(generateContent.mock.calls[0][0].config.temperature).toBeUndefined();
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toEqual({
      thinkingLevel: "MEDIUM",
    });
    const rejection = expect(result).rejects.toThrow(
      "Gemini fact checker grounding request timed out.",
    );
    await jest.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("aborts the synthesis request when the request timeout expires", async () => {
    jest.useFakeTimers();
    let synthesisSignal: AbortSignal | undefined;
    const generateContent = jest.fn().mockImplementation((request) => {
      synthesisSignal = request.config.abortSignal;
      return new Promise(() => undefined);
    });
    const service = createService(generateContent);

    const result = service.synthesize(input, {
      evidenceText: "Grounded evidence",
      webSearchQueries: ["query"],
      sources: [
        {
          sourceIndex: 0,
          title: "Source",
          publisher: "example.com",
          url: "https://example.com/evidence",
        },
      ],
    });
    expect(generateContent.mock.calls[0][0].config.temperature).toBeUndefined();
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toEqual({
      thinkingLevel: "MEDIUM",
    });
    const rejection = expect(result).rejects.toThrow(
      "Gemini fact checker synthesis request timed out.",
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(generateContent).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(synthesisSignal?.aborted).toBe(true);
  });

  it("logs synthesis token usage", async () => {
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation();
    const generateContent = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        results: [
          {
            componentId: "component-1",
            status: "SUPPORTED",
            reason: "Supported by evidence.",
            sourceIndexes: [0],
          },
        ],
      }),
      usageMetadata: {
        promptTokenCount: 100,
        cachedContentTokenCount: 20,
        candidatesTokenCount: 30,
        thoughtsTokenCount: 40,
        totalTokenCount: 170,
      },
    });
    const service = createService(generateContent);

    await service.synthesize(input, {
      evidenceText: "Grounded evidence",
      webSearchQueries: ["query"],
      sources: [
        {
          sourceIndex: 0,
          title: "Source",
          publisher: "example.com",
          url: "https://example.com/evidence",
        },
      ],
    });

    const request = generateContent.mock.calls[0][0];
    expect(request.config.systemInstruction).toContain(
      "missing evidence alone is not partial support",
    );
    expect(
      JSON.parse(request.contents[0].parts[0].text).outputRules
        .maxSourceIndexesPerResult,
    ).toBe(5);
    expect(
      request.config.responseSchema.properties.results.items.properties.status
        .enum,
    ).toEqual([
      "SUPPORTED",
      "CONTRADICTED",
      "PARTIALLY_SUPPORTED",
      "INSUFFICIENT_EVIDENCE",
      "NOT_VERIFIABLE",
      "OUTDATED",
    ]);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "stage=SYNTHESIS debateId=debate-1 phase=OPENING round=1 targets=1",
      ),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "inputTokens=100 cachedTokens=20 outputTokens=30 thinkingTokens=40 totalTokens=170",
      ),
    );
  });
});

function createService(generateContent: jest.Mock): FactCheckerAiService {
  return new FactCheckerAiService(
    { models: { generateContent } } as unknown as GoogleGenAI,
    new ConfigService({
      GEMINI_API_KEY: "test-key",
      GEMINI_FACT_CHECKER_MODEL: "gemini-test",
      GEMINI_FACT_CHECK_GROUNDING_TIMEOUT_MS: 1000,
      GEMINI_FACT_CHECK_SYNTHESIS_TIMEOUT_MS: 1000,
      FACT_CHECK_MAX_SOURCES_PER_RESULT: 5,
      FACT_CHECK_MAX_REASON_LENGTH: 2000,
    }),
  );
}
