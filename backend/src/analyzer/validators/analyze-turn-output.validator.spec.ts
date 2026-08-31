import {
  ArgumentalRelationType,
  DebatePhase,
  DebateSide,
  InteractionalRelationType,
} from "../../debates/domain/debate.enums";
import { AnalyzeTurnInput, AnalyzeTurnOutput } from "../dto/analyze-turn.dto";
import { InvalidAnalyzeTurnOutputError } from "../errors/analyzer.errors";
import { validateAnalyzeTurnOutput } from "./analyze-turn-output.validator";
import { EMPTY_DEBATE_TURN_CONTENT } from "../../debates/debate-turn-content.constants";

describe("validateAnalyzeTurnOutput", () => {
  const input: AnalyzeTurnInput = {
    debate: {
      id: "debate-1",
      topic: "Should attendance count toward grades?",
      sideASpeakerId: "speaker-a",
      sideBSpeakerId: "speaker-b",
      rebuttalQuestionRounds: 2,
    },
    currentTurns: [
      {
        id: "turn-1",
        speakerId: "speaker-a",
        speakerSide: DebateSide.SIDE_A,
        phase: DebatePhase.OPENING,
        round: 1,
        sequence: 1,
        content: "Attendance should not count toward grades.",
      },
      {
        id: "turn-2",
        speakerId: "speaker-b",
        speakerSide: DebateSide.SIDE_B,
        phase: DebatePhase.OPENING,
        round: 1,
        sequence: 2,
        content: "Attendance should count toward grades.",
      },
    ],
    accumulatedGraph: {
      graphItems: [
        {
          kind: "COMPONENT",
          id: "existing-1",
          turnId: "turn-0",
          speakerId: "speaker-b",
          speakerSide: DebateSide.SIDE_B,
          phase: DebatePhase.OPENING,
          round: 1,
          turnSequence: 0,
          statement: "Attendance encourages participation.",
          isMajorClaim: true,
        },
      ],
    },
  };

  it("accepts a valid NEW to EXISTING relation", () => {
    const output: AnalyzeTurnOutput = {
      newComponents: [
        {
          localKey: "NEW_1",
          turnId: "turn-1",
          statement: "Attendance does not prove active participation.",
          isMajorClaim: false,
          requiresFactCheck: false,
        },
      ],
      newArgumentalRelations: [
        {
          from: { source: "NEW", localKey: "NEW_1" },
          to: { source: "EXISTING", componentId: "existing-1" },
          type: ArgumentalRelationType.ATTACKS,
        },
      ],
      newInteractionalRelations: [],
    };

    expect(() => validateAnalyzeTurnOutput(input, output)).not.toThrow();
  });

  it("rejects invalid localKey format", () => {
    const output: AnalyzeTurnOutput = {
      newComponents: [
        {
          localKey: "NEW_0",
          turnId: "turn-1",
          statement: "Invalid key.",
          isMajorClaim: true,
          requiresFactCheck: false,
        },
      ],
      newArgumentalRelations: [],
      newInteractionalRelations: [],
    };

    expect(() => validateAnalyzeTurnOutput(input, output)).toThrow(
      InvalidAnalyzeTurnOutputError,
    );
  });

  it("rejects unknown EXISTING references", () => {
    const output: AnalyzeTurnOutput = {
      newComponents: [
        {
          localKey: "NEW_1",
          turnId: "turn-1",
          statement: "A connected component.",
          isMajorClaim: false,
          requiresFactCheck: false,
        },
      ],
      newArgumentalRelations: [
        {
          from: { source: "NEW", localKey: "NEW_1" },
          to: { source: "EXISTING", componentId: "missing" },
          type: ArgumentalRelationType.ATTACKS,
        },
      ],
      newInteractionalRelations: [],
    };

    expect(() => validateAnalyzeTurnOutput(input, output)).toThrow(
      InvalidAnalyzeTurnOutputError,
    );
  });

  it("rejects SUPPORTS and ATTACKS for the same from/to pair", () => {
    const output: AnalyzeTurnOutput = {
      newComponents: [
        {
          localKey: "NEW_1",
          turnId: "turn-1",
          statement: "A connected component.",
          isMajorClaim: false,
          requiresFactCheck: false,
        },
      ],
      newArgumentalRelations: [
        {
          from: { source: "NEW", localKey: "NEW_1" },
          to: { source: "EXISTING", componentId: "existing-1" },
          type: ArgumentalRelationType.SUPPORTS,
        },
        {
          from: { source: "NEW", localKey: "NEW_1" },
          to: { source: "EXISTING", componentId: "existing-1" },
          type: ArgumentalRelationType.ATTACKS,
        },
      ],
      newInteractionalRelations: [],
    };

    expect(() => validateAnalyzeTurnOutput(input, output)).toThrow(
      InvalidAnalyzeTurnOutputError,
    );
  });

  it("accepts isolated non-major components", () => {
    const output: AnalyzeTurnOutput = {
      newComponents: [
        {
          localKey: "NEW_1",
          turnId: "turn-1",
          statement: "Attendance records can be inaccurate.",
          isMajorClaim: false,
          requiresFactCheck: true,
        },
      ],
      newArgumentalRelations: [],
      newInteractionalRelations: [],
    };

    expect(() => validateAnalyzeTurnOutput(input, output)).not.toThrow();
  });

  it("allows an empty turn while analyzing the other speaker normally", () => {
    const inputWithEmptyTurn: AnalyzeTurnInput = {
      ...input,
      currentTurns: [
        { ...input.currentTurns[0], content: EMPTY_DEBATE_TURN_CONTENT },
        input.currentTurns[1],
      ],
    };
    const output: AnalyzeTurnOutput = {
      newComponents: [
        {
          localKey: "NEW_1",
          turnId: "turn-2",
          statement: "Attendance encourages participation.",
          isMajorClaim: false,
          requiresFactCheck: false,
        },
      ],
      newArgumentalRelations: [],
      newInteractionalRelations: [],
    };

    expect(() =>
      validateAnalyzeTurnOutput(inputWithEmptyTurn, output),
    ).not.toThrow();
  });

  it("rejects components created for an empty turn", () => {
    const inputWithEmptyTurn: AnalyzeTurnInput = {
      ...input,
      currentTurns: [
        { ...input.currentTurns[0], content: EMPTY_DEBATE_TURN_CONTENT },
        input.currentTurns[1],
      ],
    };
    const output: AnalyzeTurnOutput = {
      newComponents: [
        {
          localKey: "NEW_1",
          turnId: "turn-1",
          statement: "The speaker did not make a statement.",
          isMajorClaim: false,
          requiresFactCheck: false,
        },
      ],
      newArgumentalRelations: [],
      newInteractionalRelations: [],
    };

    expect(() => validateAnalyzeTurnOutput(inputWithEmptyTurn, output)).toThrow(
      InvalidAnalyzeTurnOutputError,
    );
  });

  it("applies component limits independently to each turn in the round", () => {
    const output: AnalyzeTurnOutput = {
      newComponents: [
        {
          localKey: "NEW_1",
          turnId: "turn-1",
          statement: "Side A component.",
          isMajorClaim: false,
          requiresFactCheck: false,
        },
        {
          localKey: "NEW_2",
          turnId: "turn-2",
          statement: "Side B component.",
          isMajorClaim: false,
          requiresFactCheck: false,
        },
      ],
      newArgumentalRelations: [],
      newInteractionalRelations: [],
    };

    expect(() =>
      validateAnalyzeTurnOutput(input, output, {
        maxComponentsPerTurn: 1,
        maxFactCheckTargetsPerTurn: 1,
        maxComponentStatementLength: 1000,
      }),
    ).not.toThrow();
  });

  it("rejects components assigned to a turn outside the current round", () => {
    const output: AnalyzeTurnOutput = {
      newComponents: [
        {
          localKey: "NEW_1",
          turnId: "turn-unknown",
          statement: "Unknown source.",
          isMajorClaim: false,
          requiresFactCheck: false,
        },
      ],
      newArgumentalRelations: [],
      newInteractionalRelations: [],
    };

    expect(() => validateAnalyzeTurnOutput(input, output)).toThrow(
      InvalidAnalyzeTurnOutputError,
    );
  });

  it("rejects conflicting interactional relations", () => {
    const output: AnalyzeTurnOutput = {
      newComponents: [
        {
          localKey: "NEW_1",
          turnId: "turn-1",
          statement: "How does attendance prove learning?",
          isMajorClaim: false,
          requiresFactCheck: false,
        },
        {
          localKey: "NEW_2",
          turnId: "turn-2",
          statement: "It does not prove learning by itself.",
          isMajorClaim: false,
          requiresFactCheck: false,
        },
      ],
      newArgumentalRelations: [],
      newInteractionalRelations: [
        {
          from: { source: "NEW", localKey: "NEW_1" },
          to: { source: "NEW", localKey: "NEW_2" },
          type: InteractionalRelationType.QUESTIONS,
        },
        {
          from: { source: "NEW", localKey: "NEW_1" },
          to: { source: "NEW", localKey: "NEW_2" },
          type: InteractionalRelationType.ANSWERS,
        },
      ],
    };

    expect(() => validateAnalyzeTurnOutput(input, output)).toThrow(
      InvalidAnalyzeTurnOutputError,
    );
  });
});
