import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import { AnalyzerAiService } from "./analyzer-ai.service";
import { AnalyzeTurnInput } from "./dto/analyze-turn.dto";
import { DebatePhase, DebateSide } from "../debates/domain/debate.enums";

describe("AnalyzerAiService", () => {
  const input: AnalyzeTurnInput = {
    debate: {
      id: "debate-1",
      topic: "Topic",
      sideASpeakerId: "speaker-a",
      sideBSpeakerId: "speaker-b",
      rebuttalQuestionRounds: 1,
    },
    currentTurns: [
      {
        id: "turn-1",
        speakerId: "speaker-a",
        speakerSide: DebateSide.SIDE_A,
        phase: DebatePhase.REBUTTAL_QUESTION,
        round: 1,
        sequence: 3,
        content: "Side A rebuttal",
      },
      {
        id: "turn-2",
        speakerId: "speaker-b",
        speakerSide: DebateSide.SIDE_B,
        phase: DebatePhase.REBUTTAL_QUESTION,
        round: 1,
        sequence: 4,
        content: "Side B response",
      },
    ],
    accumulatedGraph: {
      components: [],
      argumentalRelations: [],
      interactionalRelations: [],
    },
  };

  it("sends both turns once without an output-token cap and logs usage", async () => {
    const generateContent = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        newComponents: [],
        newArgumentalRelations: [],
        newInteractionalRelations: [],
      }),
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 30,
        totalTokenCount: 150,
      },
    });
    const loggerSpy = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
    const service = new AnalyzerAiService(
      { models: { generateContent } } as unknown as GoogleGenAI,
      new ConfigService({
        GEMINI_API_KEY: "test-key",
        GEMINI_ANALYZER_MODEL: "gemini-test",
        GEMINI_ANALYZER_MAX_RETRIES: 0,
        GEMINI_REQUEST_TIMEOUT_MS: 1000,
      }),
    );

    await service.analyze(input);

    expect(generateContent).toHaveBeenCalledTimes(1);
    const request = generateContent.mock.calls[0][0];
    expect(
      JSON.parse(request.contents[0].parts[0].text).currentTurns,
    ).toHaveLength(2);
    expect(request.config.maxOutputTokens).toBeUndefined();
    expect(request.config.systemInstruction).toContain(
      'trimmed content is exactly "발언 없음"',
    );
    expect(request.config.systemInstruction).toContain(
      "infer at most one Major Claim",
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining("inputTokens=100 outputTokens=20"),
    );
    loggerSpy.mockRestore();
  });
});
