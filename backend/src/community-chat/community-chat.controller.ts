import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { CurrentMember } from "../auth/current-member.decorator";
import { AuthPrincipal } from "../auth/dto/auth.dto";
import { CommunityChatService } from "./community-chat.service";
import {
  CommunityDto,
  CommunityMemberDto,
  CommunityMessageDto,
  CommunityOpinionDto,
} from "./dto/community-chat.dto";
import {
  validateCreateCommunityRequest,
  validateSaveCommunityOpinionRequest,
  validateSendCommunityMessageRequest,
  validateUpdateCommunityDebateIntentRequest,
} from "./validators/community-chat.validator";

@Controller("communities")
export class CommunityChatController {
  constructor(private readonly service: CommunityChatService) {}

  @Post()
  create(
    @CurrentMember() principal: AuthPrincipal,
    @Body() body: unknown,
  ): Promise<CommunityDto> {
    return this.service.createCommunity(
      principal.memberId,
      validateCreateCommunityRequest(body),
    );
  }

  @Get()
  list(@CurrentMember() principal: AuthPrincipal): Promise<CommunityDto[]> {
    return this.service.listCommunities(principal.memberId);
  }

  @Get(":communityId")
  get(
    @Param("communityId") communityId: string,
    @CurrentMember() principal: AuthPrincipal,
  ): Promise<CommunityDto> {
    return this.service.getCommunity(communityId, principal.memberId);
  }

  @Post(":communityId/members/me")
  @HttpCode(204)
  join(
    @Param("communityId") communityId: string,
    @CurrentMember() principal: AuthPrincipal,
  ): Promise<void> {
    return this.service.joinCommunity(communityId, principal.memberId);
  }

  @Delete(":communityId/members/me")
  @HttpCode(204)
  leave(
    @Param("communityId") communityId: string,
    @CurrentMember() principal: AuthPrincipal,
  ): Promise<void> {
    return this.service.leaveCommunity(communityId, principal.memberId);
  }

  @Get(":communityId/members")
  listMembers(
    @Param("communityId") communityId: string,
  ): Promise<CommunityMemberDto[]> {
    return this.service.listCommunityMembers(communityId);
  }

  @Put(":communityId/members/me/debate-intent")
  @HttpCode(204)
  updateMyDebateIntent(
    @Param("communityId") communityId: string,
    @CurrentMember() principal: AuthPrincipal,
    @Body() body: unknown,
  ): Promise<void> {
    return this.service.updateCommunityDebateIntent(
      communityId,
      principal.memberId,
      validateUpdateCommunityDebateIntentRequest(body).debateIntent,
    );
  }

  @Get(":communityId/messages")
  listMessages(
    @Param("communityId") communityId: string,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("before") before?: string,
  ): Promise<CommunityMessageDto[]> {
    const beforeDate = before ? new Date(before) : undefined;
    return this.service.listMessages(
      communityId,
      limit,
      beforeDate && !Number.isNaN(beforeDate.getTime())
        ? beforeDate
        : undefined,
    );
  }

  @Post(":communityId/messages")
  async sendMessage(
    @Param("communityId") communityId: string,
    @CurrentMember() principal: AuthPrincipal,
    @Body() body: unknown,
  ): Promise<CommunityMessageDto> {
    return (
      await this.service.sendMessage(
        communityId,
        principal.memberId,
        validateSendCommunityMessageRequest(body),
      )
    ).message;
  }

  @Get(":communityId/opinions")
  listOpinions(
    @Param("communityId") communityId: string,
  ): Promise<CommunityOpinionDto[]> {
    return this.service.listOpinions(communityId);
  }

  @Put(":communityId/opinions/me")
  saveMyOpinion(
    @Param("communityId") communityId: string,
    @CurrentMember() principal: AuthPrincipal,
    @Body() body: unknown,
  ): Promise<CommunityOpinionDto> {
    return this.service.saveOpinion(
      communityId,
      principal.memberId,
      validateSaveCommunityOpinionRequest(body),
    );
  }
}
