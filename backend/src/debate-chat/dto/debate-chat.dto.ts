import { DebatePhase, DebateSide } from "../../debates/domain/debate.enums";

export const DEBATE_TURN_SEND_COMMAND = "debate.turn.send";
export const DEBATE_TURN_MESSAGE_SEND_COMMAND = "debate.turn.message.send";
export const DEBATE_TURN_FINALIZE_COMMAND = "debate.turn.finalize";
export const DEBATE_CONNECTION_RESTORED_EVENT = "connection.restored";
export const DEBATE_TURN_MESSAGE_CREATED_EVENT = "debate.turn.message.created";
export const DEBATE_TURN_FINALIZED_EVENT = "debate.turn.finalized";
export const DEBATE_CHAT_ERROR_EVENT = "error";

export interface DebateTurnMessageSendCommand {
  id: string;
  type:
    typeof DEBATE_TURN_SEND_COMMAND | typeof DEBATE_TURN_MESSAGE_SEND_COMMAND;
  debateId?: string;
  clientMessageId?: string;
  payload: {
    speakerId: string;
    speakerSide: DebateSide;
    phase: DebatePhase;
    round: number;
    content: string;
  };
  sentAt?: string;
}

export interface DebateTurnFinalizeCommand {
  id: string;
  type: typeof DEBATE_TURN_FINALIZE_COMMAND;
  debateId?: string;
  payload: {
    speakerId: string;
    speakerSide: DebateSide;
    phase: DebatePhase;
    round: number;
  };
}

export type DebateChatClientCommand =
  DebateTurnMessageSendCommand | DebateTurnFinalizeCommand;

export interface DebateChatDraftMessageDto {
  id: string;
  debateId: string;
  clientMessageId?: string;
  speakerId: string;
  speakerSide: DebateSide;
  phase: DebatePhase;
  round: number;
  content: string;
  createdAt: string;
}

export interface DebateChatCurrentTurnDto {
  phase: DebatePhase;
  round: number;
  turnSide: DebateSide;
  startedAt: string;
  maxDurationSeconds: number;
  maxTotalCharacters: number;
}

export interface DebateChatTurnDto {
  id: string;
  debateId: string;
  clientMessageId?: string;
  speakerId: string;
  speakerSide: DebateSide;
  phase: DebatePhase;
  round: number;
  sequence: number;
  content: string;
  createdAt: string;
}

export interface DebateConnectionRestoredEvent {
  id: string;
  type: typeof DEBATE_CONNECTION_RESTORED_EVENT;
  debateId: string;
  currentTurn: DebateChatCurrentTurnDto | null;
  turns: DebateChatTurnDto[];
  draftMessages: DebateChatDraftMessageDto[];
}

export interface DebateTurnMessageCreatedEvent {
  id: string;
  type: typeof DEBATE_TURN_MESSAGE_CREATED_EVENT;
  debateId: string;
  message: DebateChatDraftMessageDto;
}

export interface DebateTurnFinalizedEvent {
  id: string;
  type: typeof DEBATE_TURN_FINALIZED_EVENT;
  debateId: string;
  turn: DebateChatTurnDto;
}

export interface DebateChatErrorEvent {
  id: string;
  type: typeof DEBATE_CHAT_ERROR_EVENT;
  debateId?: string;
  commandId?: string;
  code: string;
  message: string;
}

export type DebateChatServerEvent =
  | DebateConnectionRestoredEvent
  | DebateTurnMessageCreatedEvent
  | DebateTurnFinalizedEvent
  | DebateChatErrorEvent;
