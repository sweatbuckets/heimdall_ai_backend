import { VerificationStatus } from "../domain/debate.enums";
import { ArgumentComponentEntity } from "../entities/argument-component.entity";
import { FactCheckResultEntity } from "../entities/fact-check-result.entity";
import { FactCheckSourceEntity } from "../entities/fact-check-source.entity";
import { DebateTurnEntity } from "../entities/debate-turn.entity";
import { mapFactCheckResultResponse } from "./fact-check-result-response.dto";

describe("mapFactCheckResultResponse", () => {
  it("maps the checked statement, verdict reason, and sources", () => {
    const component = Object.assign(new ArgumentComponentEntity(), {
      id: "component-id",
      statement: "지구의 평균 기온은 지속해서 상승하고 있다.",
      turn: Object.assign(new DebateTurnEntity(), {
        speakerId: "speaker-id",
        speakerSide: "SIDE_A",
      }),
    });
    const source = Object.assign(new FactCheckSourceEntity(), {
      title: "Climate report",
      publisher: "Example Institute",
      url: "https://example.com/climate-report",
    });
    const result = Object.assign(new FactCheckResultEntity(), {
      id: "result-id",
      componentId: component.id,
      component,
      status: VerificationStatus.SUPPORTED,
      reason: "장기 관측 자료가 해당 주장을 뒷받침한다.",
      sources: [source],
      checkedAt: new Date("2026-08-23T05:00:00.000Z"),
    });

    expect(mapFactCheckResultResponse(result)).toEqual({
      id: "result-id",
      componentId: "component-id",
      speakerId: "speaker-id",
      speakerSide: "SIDE_A",
      statement: "지구의 평균 기온은 지속해서 상승하고 있다.",
      status: "SUPPORTED",
      reason: "장기 관측 자료가 해당 주장을 뒷받침한다.",
      sources: [
        {
          title: "Climate report",
          publisher: "Example Institute",
          url: "https://example.com/climate-report",
        },
      ],
      checkedAt: "2026-08-23T05:00:00.000Z",
    });
  });
});
