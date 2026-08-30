import { DebateSide, VerificationStatus } from "../domain/debate.enums";
import { FactCheckResultEntity } from "../entities/fact-check-result.entity";

export interface FactCheckSourceResponseDto {
  title: string;
  publisher: string;
  url: string;
}

export interface FactCheckResultResponseDto {
  id: string;
  componentId: string;
  speakerId: string;
  speakerSide: DebateSide;
  statement: string;
  status: VerificationStatus;
  reason: string;
  sources: FactCheckSourceResponseDto[];
  checkedAt: string;
}

export function mapFactCheckResultResponse(
  entity: FactCheckResultEntity,
): FactCheckResultResponseDto {
  return {
    id: entity.id,
    componentId: entity.componentId,
    speakerId: entity.component.turn.speakerId,
    speakerSide: entity.component.turn.speakerSide,
    statement: entity.component.statement,
    status: entity.status,
    reason: entity.reason,
    sources: entity.sources.map((source) => ({
      title: source.title,
      publisher: source.publisher,
      url: source.url,
    })),
    checkedAt: entity.checkedAt.toISOString(),
  };
}
