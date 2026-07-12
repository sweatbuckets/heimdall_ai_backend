import { DebatePhase, DebateSide, DebateStatus } from "../domain/debate.enums";
import { DebateChatTurnDto } from "../../debate-chat/dto/debate-chat.dto";
import { JudgmentResultResponseDto } from "../../judge/dto/judgment-result-response.dto";

export interface CreateDebateRequest {
  topic: string;
  sideASpeakerId: string;
  sideBSpeakerId: string;
  rebuttalQuestionRounds: number;
}

export interface DebateDto {
  id: string;
  topic: string;
  sideASpeakerId: string;
  sideBSpeakerId: string;
  rebuttalQuestionRounds: number;
  status: DebateStatus;
  currentPhase: DebatePhase | null;
  currentRound: number | null;
  currentTurnSide: DebateSide | null;
  currentTurnStartedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface DebateDetailDto extends DebateDto {
  turns: DebateChatTurnDto[];
}

export interface DebateResultDto {
  debate: DebateDto;
  judgmentResult: JudgmentResultResponseDto;
}
