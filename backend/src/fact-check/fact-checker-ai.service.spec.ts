import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import { FactCheckerAiService } from "./fact-checker-ai.service";
import { FactCheckBatchInput } from "./dto/fact-check-batch.dto";

describe("FactCheckerAiService timeouts", () => {
  const input: FactCheckBatchInput = {
    debate: { id: "debate-1", topic: "Topic" },
    turn: { id: "turn-1", sequence: 1 },
    targets: [{ componentId: "component-1", statement: "A factual claim" }],
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

    const result = service.check(input);
    const rejection = expect(result).rejects.toThrow(
      "Gemini fact checker grounding request timed out.",
    );
    await jest.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });

  it("aborts the synthesis request when the request timeout expires", async () => {
    jest.useFakeTimers();
    let synthesisSignal: AbortSignal | undefined;
    const generateContent = jest
      .fn()
      .mockResolvedValueOnce({
        text: "Grounded evidence",
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    title: "Source",
                    uri: "https://example.com/evidence",
                  },
                },
              ],
              webSearchQueries: ["query"],
            },
          },
        ],
      })
      .mockImplementationOnce((request) => {
        synthesisSignal = request.config.abortSignal;
        return new Promise(() => undefined);
      });
    const service = createService(generateContent);

    const result = service.check(input);
    const rejection = expect(result).rejects.toThrow(
      "Gemini fact checker synthesis request timed out.",
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(generateContent).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(synthesisSignal?.aborted).toBe(true);
  });
});

function createService(generateContent: jest.Mock): FactCheckerAiService {
  return new FactCheckerAiService(
    { models: { generateContent } } as unknown as GoogleGenAI,
    new ConfigService({
      GEMINI_API_KEY: "test-key",
      GEMINI_FACT_CHECKER_MODEL: "gemini-test",
      GEMINI_FACT_CHECKER_MAX_RETRIES: 0,
      GEMINI_REQUEST_TIMEOUT_MS: 1000,
      FACT_CHECK_MAX_SOURCES_PER_RESULT: 5,
      FACT_CHECK_MAX_REASON_LENGTH: 2000,
    }),
  );
}
