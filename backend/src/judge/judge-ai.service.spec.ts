import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import { JudgeAiService } from "./judge-ai.service";
import { JudgeInput } from "./dto/judge.dto";
import { Logger } from "@nestjs/common";

describe("JudgeAiService timeouts", () => {
  const input: JudgeInput = {
    debate: {
      id: "debate-1",
      topic: "Topic",
      sideASpeakerId: "speaker-a",
      sideASpeakerDisplayName: "민수",
      sideBSpeakerId: "speaker-b",
      sideBSpeakerDisplayName: "영희",
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
        GEMINI_JUDGE_TIMEOUT_MS: 1000,
      }),
    );

    const result = service.judge(input);
    expect(generateContent.mock.calls[0][0].config.temperature).toBeUndefined();
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toEqual({
      thinkingLevel: "MEDIUM",
    });
    const rejection = expect(result).rejects.toThrow(
      "Gemini judge request timed out.",
    );
    await jest.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("logs judge token usage", async () => {
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation();
    const generateContent = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        sideAArgumentationScore: 30,
        sideAInteractionScore: 20,
        sideAFactualReliabilityScore: 20,
        sideBArgumentationScore: 25,
        sideBInteractionScore: 20,
        sideBFactualReliabilityScore: 20,
        overallReason: "Side A was stronger.",
        sideAFeedback: "Keep the structure.",
        sideBFeedback: "Use more evidence.",
      }),
      usageMetadata: {
        promptTokenCount: 200,
        cachedContentTokenCount: 50,
        candidatesTokenCount: 40,
        thoughtsTokenCount: 60,
        totalTokenCount: 300,
      },
    });
    const service = new JudgeAiService(
      { models: { generateContent } } as unknown as GoogleGenAI,
      new ConfigService({
        GEMINI_API_KEY: "test-key",
        GEMINI_JUDGE_MODEL: "gemini-test",
        GEMINI_JUDGE_TIMEOUT_MS: 1000,
      }),
    );

    await service.judge(input);

    const request = generateContent.mock.calls[0][0];
    expect(request.config.systemInstruction).toContain(
      "do not treat either as false automatically",
    );
    expect(request.config.systemInstruction).toContain(
      "do not double-penalize it as CONTRADICTED",
    );
    expect(request.config.systemInstruction).toContain(
      "debate.sideASpeakerDisplayName",
    );
    expect(request.config.systemInstruction).toContain(
      "Never call a speaker SIDE_A",
    );

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("debateId=debate-1"),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "inputTokens=200 cachedTokens=50 outputTokens=40 thinkingTokens=60 totalTokens=300",
      ),
    );
  });
});
