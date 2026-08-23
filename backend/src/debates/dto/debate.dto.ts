import { DebatePhase, DebateSide, DebateStatus } from "../domain/debate.enums";
import { JudgmentResultResponseDto } from "../../judge/dto/judgment-result-response.dto";
import { DebateTurnWithVotesDto } from "./debate-turn-vote.dto";
import { FactCheckResultResponseDto } from "./fact-check-result-response.dto";

export interface CreateDebateRequest {
  communityId: string;
  topic: string;
  sideASpeakerId: string;
  sideBSpeakerId: string;
  rebuttalQuestionRounds: number;
}

export interface DebateDto {
  id: string;
  communityId: string;
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
  judgingStartedAt: string | null;
  expiresAt: string | null;
}

export interface DebateDetailDto extends DebateDto {
  sideASpeaker: DebateSpeakerDto;
  sideBSpeaker: DebateSpeakerDto;
  viewerSide: DebateSide | null;
  turns: DebateTurnWithVotesDto[];
}

export interface DebateSpeakerDto {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  score: number;
}

export interface StartCommunityDebateRequest {
  opponentMemberId: string;
}

export interface DebateResultDto {
  debate: DebateDto;
  viewerSide: DebateSide | null;
  judgmentResult: JudgmentResultResponseDto;
  factChecks: FactCheckResultResponseDto[];
}
