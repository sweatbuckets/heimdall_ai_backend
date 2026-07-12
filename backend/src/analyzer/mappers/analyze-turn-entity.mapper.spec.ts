import {
  ArgumentalRelationType,
  DebatePhase,
  DebateSide,
} from "../../debates/domain/debate.enums";
import { AnalyzeTurnInput, AnalyzeTurnOutput } from "../dto/analyze-turn.dto";
import { mapAnalyzeTurnOutputToEntities } from "./analyze-turn-entity.mapper";

describe("mapAnalyzeTurnOutputToEntities", () => {
  it("maps localKeys to generated component ids and trims statements", () => {
    const input: AnalyzeTurnInput = {
      debate: {
        id: "debate-1",
        topic: "Topic",
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
        content: "Content",
      },
      accumulatedGraph: {
        components: [],
        argumentalRelations: [],
        interactionalRelations: [],
      },
    };
    const output: AnalyzeTurnOutput = {
      newComponents: [
        {
          localKey: "NEW_1",
          statement: "  Major claim  ",
          isMajorClaim: true,
          requiresFactCheck: true,
        },
        {
          localKey: "NEW_2",
          statement: "Reason",
          isMajorClaim: false,
          requiresFactCheck: false,
        },
      ],
      newArgumentalRelations: [
        {
          from: { source: "NEW", localKey: "NEW_2" },
          to: { source: "NEW", localKey: "NEW_1" },
          type: ArgumentalRelationType.SUPPORTS,
        },
      ],
      newInteractionalRelations: [],
    };

    const mapped = mapAnalyzeTurnOutputToEntities(input, output);
    const new1Id = mapped.localKeyToComponentId.get("NEW_1");
    const new2Id = mapped.localKeyToComponentId.get("NEW_2");

    expect(new1Id).toBeDefined();
    expect(new2Id).toBeDefined();
    expect(new1Id).not.toBe(new2Id);
    expect(mapped.components).toHaveLength(2);
    expect(mapped.components[0]).toMatchObject({
      turnId: "turn-1",
      statement: "Major claim",
      requiresFactCheck: true,
    });
    expect(mapped.factCheckTargetComponentIds).toEqual([new1Id]);
    expect(mapped.argumentalRelations[0]).toMatchObject({
      fromComponentId: new2Id,
      toComponentId: new1Id,
      type: ArgumentalRelationType.SUPPORTS,
    });
  });
});
