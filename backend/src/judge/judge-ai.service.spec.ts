import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import { JudgeAiService } from "./judge-ai.service";
import { JudgeInput } from "./dto/judge.dto";

describe("JudgeAiService timeouts", () => {
  const input: JudgeInput = {
    debate: {
      id: "debate-1",
      topic: "Topic",
      sideASpeakerId: "speaker-a",
      sideBSpeakerId: "speaker-b",
      rebuttalQuestionRounds: 1,
    },
    argumentGraph: {
      components: [],
      argumentalRelations: [],
      interactionalRelations: [],
    },
    factCheckResults: [],
  };

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("aborts the judge request when the request timeout expires", async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const generateContent = jest.fn().mockImplementation((request) => {
      requestSignal = request.config.abortSignal;
      return new Promise(() => undefined);
    });
    const service = new JudgeAiService(
      { models: { generateContent } } as unknown as GoogleGenAI,
      new ConfigService({
        GEMINI_API_KEY: "test-key",
        GEMINI_JUDGE_MODEL: "gemini-test",
        GEMINI_JUDGE_MAX_RETRIES: 0,
        GEMINI_REQUEST_TIMEOUT_MS: 1000,
      }),
    );

    const result = service.judge(input);
    const rejection = expect(result).rejects.toThrow(
      "Gemini judge request timed out.",
    );
    await jest.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });
});
