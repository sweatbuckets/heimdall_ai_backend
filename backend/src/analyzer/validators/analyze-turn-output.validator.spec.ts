import {
  ArgumentalRelationType,
  DebatePhase,
  DebateSide,
  InteractionalRelationType,
} from "../../debates/domain/debate.enums";
import { AnalyzeTurnInput, AnalyzeTurnOutput } from "../dto/analyze-turn.dto";
import { InvalidAnalyzeTurnOutputError } from "../errors/analyzer.errors";
import { validateAnalyzeTurnOutput } from "./analyze-turn-output.validator";

describe("validateAnalyzeTurnOutput", () => {
  const input: AnalyzeTurnInput = {
    debate: {
      id: "debate-1",
      topic: "Should attendance count toward grades?",
      sideASpeakerId: "speaker-a",
      sideBSpeakerId: "speaker-b",
      rebuttalQuestionRounds: 2,
    },
    currentTurn: {
      id: "turn-1",
      speakerId: "speaker-a",
      speakerSide: DebateSide.SIDE_A,
      phase: DebatePhase.OPENING,
      round: 1,
      sequence: 1,
      content: "Attendance should not count toward grades.",
    },
    accumulatedGraph: {
      components: [
        {
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
      argumentalRelations: [],
      interactionalRelations: [],
    },
  };

  it("accepts a valid NEW to EXISTING relation", () => {
    const output: AnalyzeTurnOutput = {
      newComponents: [
        {
          localKey: "NEW_1",
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

  it("rejects isolated non-major components", () => {
    const output: AnalyzeTurnOutput = {
      newComponents: [
        {
          localKey: "NEW_1",
          statement: "I am isolated.",
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
          statement: "How does attendance prove learning?",
          isMajorClaim: false,
          requiresFactCheck: false,
        },
        {
          localKey: "NEW_2",
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
