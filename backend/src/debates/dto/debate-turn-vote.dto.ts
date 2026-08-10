import { DebateChatTurnDto } from "../../debate-chat/dto/debate-chat.dto";
import { DebateTurnVoteType } from "../domain/debate.enums";

export interface SetDebateTurnVoteRequest {
  type: DebateTurnVoteType;
}

export interface DebateTurnVoteSummaryDto {
  turnId: string;
  likeCount: number;
  dislikeCount: number;
}

export interface DebateTurnWithVotesDto extends DebateChatTurnDto {
  likeCount: number;
  dislikeCount: number;
}
