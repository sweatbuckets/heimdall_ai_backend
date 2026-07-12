import {
  ArgumentalRelationType,
  DebatePhase,
  DebateSide,
  DebateStatus,
  DebateTurnAnalysisStatus,
  FactCheckBatchTaskStatus,
  VerificationStatus,
} from "../../debates/domain/debate.enums";
import { JudgeInput, JudgeValidationContext } from "../dto/judge.dto";
import { JudgeInputError } from "../errors/judge.errors";
import { validateJudgeInput } from "./judge-input.validator";

describe("validateJudgeInput", () => {
  const input: JudgeInput = {
    debate: {
      id: "debate-1",
      topic: "Should attendance count toward grades?",
      sideASpeakerId: "speaker-a",
      sideBSpeakerId: "speaker-b",
      rebuttalQuestionRounds: 2,
    },
    argumentGraph: {
      components: [
        {
          id: "component-a",
          speakerId: "speaker-a",
          speakerSide: DebateSide.SIDE_A,
          phase: DebatePhase.OPENING,
          round: 1,
          turnSequence: 1,
          statement: "Attendance should not count toward grades.",
          isMajorClaim: true,
          requiresFactCheck: true,
        },
        {
          id: "component-b",
          speakerId: "speaker-b",
          speakerSide: DebateSide.SIDE_B,
          phase: DebatePhase.OPENING,
          round: 1,
          turnSequence: 2,
          statement: "Attendance improves participation.",
          isMajorClaim: true,
          requiresFactCheck: false,
        },
      ],
      argumentalRelations: [
        {
          fromComponentId: "component-a",
          toComponentId: "component-b",
          type: ArgumentalRelationType.ATTACKS,
        },
      ],
      interactionalRelations: [],
    },
    factCheckResults: [
      {
        componentId: "component-a",
        status: VerificationStatus.PARTIALLY_SUPPORTED,
        reason: "Evidence is mixed.",
      },
    ],
  };
  const context: JudgeValidationContext = {
    debateStatus: DebateStatus.JUDGING,
    turns: [
      {
        id: "turn-1",
        analysisStatus: DebateTurnAnalysisStatus.COMPLETED,
      },
    ],
    factCheckBatchTasks: [
      {
        id: "task-1",
        status: FactCheckBatchTaskStatus.COMPLETED,
      },
    ],
    hasExistingJudgmentResult: false,
  };

  it("accepts a valid JudgeInput", () => {
    expect(() => validateJudgeInput(input, context)).not.toThrow();
  });

  it("rejects invalid debate status", () => {
    expect(() =>
      validateJudgeInput(input, {
        ...context,
        debateStatus: DebateStatus.IN_PROGRESS,
      }),
    ).toThrow(JudgeInputError);
  });

  it("rejects incomplete Analyzer processing", () => {
    expect(() =>
      validateJudgeInput(input, {
        ...context,
        turns: [
          {
            id: "turn-1",
            analysisStatus: DebateTurnAnalysisStatus.PROCESSING,
          },
        ],
      }),
    ).toThrow(JudgeInputError);
  });

  it("rejects incomplete FactCheckBatchTask", () => {
    expect(() =>
      validateJudgeInput(input, {
        ...context,
        factCheckBatchTasks: [
          {
            id: "task-1",
            status: FactCheckBatchTaskStatus.QUEUED,
          },
        ],
      }),
    ).toThrow(JudgeInputError);
  });

  it("rejects missing FactCheckResult for requiresFactCheck components", () => {
    expect(() =>
      validateJudgeInput(
        {
          ...input,
          factCheckResults: [],
        },
        context,
      ),
    ).toThrow(JudgeInputError);
  });

  it("rejects duplicate FactCheckResults", () => {
    expect(() =>
      validateJudgeInput(
        {
          ...input,
          factCheckResults: [
            input.factCheckResults[0],
            input.factCheckResults[0],
          ],
        },
        context,
      ),
    ).toThrow(JudgeInputError);
  });

  it("rejects relations that reference missing components", () => {
    expect(() =>
      validateJudgeInput(
        {
          ...input,
          argumentGraph: {
            ...input.argumentGraph,
            argumentalRelations: [
              {
                fromComponentId: "component-a",
                toComponentId: "missing",
                type: ArgumentalRelationType.ATTACKS,
              },
            ],
          },
        },
        context,
      ),
    ).toThrow(JudgeInputError);
  });

  it("rejects relation self references", () => {
    expect(() =>
      validateJudgeInput(
        {
          ...input,
          argumentGraph: {
            ...input.argumentGraph,
            argumentalRelations: [
              {
                fromComponentId: "component-a",
                toComponentId: "component-a",
                type: ArgumentalRelationType.SUPPORTS,
              },
            ],
          },
        },
        context,
      ),
    ).toThrow(JudgeInputError);
  });

  it("rejects speakerId and speakerSide mismatch", () => {
    expect(() =>
      validateJudgeInput(
        {
          ...input,
          argumentGraph: {
            ...input.argumentGraph,
            components: [
              {
                ...input.argumentGraph.components[0],
                speakerSide: DebateSide.SIDE_B,
              },
              input.argumentGraph.components[1],
            ],
          },
        },
        context,
      ),
    ).toThrow(JudgeInputError);
  });

  it("rejects existing JudgmentResult", () => {
    expect(() =>
      validateJudgeInput(input, {
        ...context,
        hasExistingJudgmentResult: true,
      }),
    ).toThrow(JudgeInputError);
  });
});
