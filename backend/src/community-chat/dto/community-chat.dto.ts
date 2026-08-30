import { CommunityStatus } from "../domain/community-chat.enums";
import { CommunityDebateIntent } from "../domain/community-chat.enums";
import { CommunityMessageType } from "../entities/community-message.entity";

export const COMMUNITY_MESSAGE_ACK_EVENT = "community.message.ack";
export const COMMUNITY_OPINION_ACK_EVENT = "community.opinion.ack";
export const COMMUNITY_COMMAND_STATUS_STORED = "STORED";
export const COMMUNITY_COMMAND_STATUS_DUPLICATE = "DUPLICATE";

export type CommunityCommandStatus =
  | typeof COMMUNITY_COMMAND_STATUS_STORED
  | typeof COMMUNITY_COMMAND_STATUS_DUPLICATE;

export interface CreateCommunityRequest {
  title: string;
  topic: string;
  category: string;
  rounds: number;
  isPublic: boolean;
  hostClaim: string;
  hostReasons: string[];
}

export interface CommunityDto {
  id: string;
  title: string;
  topic: string;
  category: string;
  status: CommunityStatus;
  rounds: number;
  isPublic: boolean;
  hostClaim: string;
  hostReasons: string[];
  host: { id: string; displayName: string };
  memberCount: number;
  createdAt: string;
  isOwnedByCurrentUser: boolean;
  isJoined: boolean;
}

export interface CommunityMemberDto {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  role: string;
  debateIntent: CommunityDebateIntent;
  joinedAt: string;
}

export interface UpdateCommunityDebateIntentRequest {
  debateIntent: CommunityDebateIntent;
}

export interface SendCommunityMessageRequest {
  clientMessageId: string;
  text: string;
}

export interface SaveCommunityOpinionRequest {
  claim: string;
  reasons: string[];
}

export interface CommunityOpinionDto {
  id: string;
  communityId: string;
  authorId: string;
  authorName: string;
  claim: string;
  reasons: string[];
  createdAt: string;
  updatedAt: string;
  action?: "CREATED" | "UPDATED";
}

export interface CommunityMessageDto {
  id: string;
  communityId: string;
  clientMessageId: string;
  authorId: string;
  authorName: string;
  text: string;
  messageType: CommunityMessageType;
  debateId: string | null;
  createdAt: string;
}

export interface CommunityMessageCreatedEvent {
  id: string;
  type: "message.created";
  communityId: string;
  message: CommunityMessageDto;
}

export interface CommunityOpinionSubmittedEvent {
  id: string;
  type: "opinion.submitted";
  communityId: string;
  opinion: CommunityOpinionDto;
}

export interface CommunityMessageAckEvent {
  id: string;
  type: typeof COMMUNITY_MESSAGE_ACK_EVENT;
  communityId: string;
  commandId: string;
  clientMessageId: string;
  status: CommunityCommandStatus;
  message: CommunityMessageDto;
}

export interface CommunityOpinionAckEvent {
  id: string;
  type: typeof COMMUNITY_OPINION_ACK_EVENT;
  communityId: string;
  commandId: string;
  status: typeof COMMUNITY_COMMAND_STATUS_STORED;
  opinion: CommunityOpinionDto;
}
