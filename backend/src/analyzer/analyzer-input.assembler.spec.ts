import { Repository } from "typeorm";
import { AnalyzerInputAssembler } from "./analyzer-input.assembler";
import { AnalyzeTurnInputError } from "./errors/analyzer.errors";
import { DebatePhase, DebateSide } from "../debates/domain/debate.enums";
import { ArgumentalRelationEntity } from "../debates/entities/argumental-relation.entity";
import { DebateTurnEntity } from "../debates/entities/debate-turn.entity";
import { InteractionalRelationEntity } from "../debates/entities/interactional-relation.entity";

describe("AnalyzerInputAssembler", () => {
  const debate = {
    id: "debate-1",
    topic: "Topic",
    sideASpeakerId: "speaker-a",
    sideBSpeakerId: "speaker-b",
    rebuttalQuestionRounds: 2,
  };
  const sideATurn = {
    id: "turn-3",
    debateId: debate.id,
    debate,
    speakerId: debate.sideASpeakerId,
    speakerSide: DebateSide.SIDE_A,
    phase: DebatePhase.REBUTTAL_QUESTION,
    round: 1,
    sequence: 3,
    content: "Side A rebuttal",
  } as DebateTurnEntity;
  const sideBTurn = {
    id: "turn-4",
    debateId: debate.id,
    debate,
    speakerId: debate.sideBSpeakerId,
    speakerSide: DebateSide.SIDE_B,
    phase: DebatePhase.REBUTTAL_QUESTION,
    round: 1,
    sequence: 4,
    content: "Side B response",
  } as DebateTurnEntity;

  function createAssembler(roundTurns: DebateTurnEntity[]) {
    const turnRepository = {
      findOne: jest.fn().mockResolvedValue(sideATurn),
      find: jest
        .fn()
        .mockResolvedValueOnce(roundTurns)
        .mockResolvedValueOnce([]),
    };
    const argumentalRelationRepository = { find: jest.fn() };
    const interactionalRelationRepository = { find: jest.fn() };

    return {
      assembler: new AnalyzerInputAssembler(
        turnRepository as unknown as Repository<DebateTurnEntity>,
        argumentalRelationRepository as unknown as Repository<ArgumentalRelationEntity>,
        interactionalRelationRepository as unknown as Repository<InteractionalRelationEntity>,
      ),
      turnRepository,
    };
  }

  it("assembles both speakers in sequence order as one current round", async () => {
    const { assembler, turnRepository } = createAssembler([
      sideATurn,
      sideBTurn,
    ]);

    const input = await assembler.assemble(sideATurn.id);

    expect(input.currentTurns.map((turn) => turn.id)).toEqual([
      sideATurn.id,
      sideBTurn.id,
    ]);
    expect(turnRepository.find).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ debateId: debate.id }),
        order: { sequence: "ASC" },
      }),
    );
  });

  it("rejects an incomplete round", async () => {
    const { assembler } = createAssembler([sideATurn]);

    await expect(assembler.assemble(sideATurn.id)).rejects.toThrow(
      AnalyzeTurnInputError,
    );
  });
});
