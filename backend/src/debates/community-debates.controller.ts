import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { AuthPrincipal } from "../auth/dto/auth.dto";
import { CurrentMember } from "../auth/current-member.decorator";
import { assertUuid } from "../common/http/id.validator";
import { DebatesService } from "./debates.service";
import { DebateDetailDto } from "./dto/debate.dto";
import { validateStartCommunityDebateRequest } from "./validators/start-community-debate.validator";

@Controller("communities/:communityId/debates")
export class CommunityDebatesController {
  constructor(private readonly debatesService: DebatesService) {}

  @Post("start")
  async start(
    @Param("communityId") communityId: string,
    @CurrentMember() principal: AuthPrincipal,
    @Body() body: unknown,
  ): Promise<DebateDetailDto> {
    assertUuid(communityId, "communityId");
    const input = validateStartCommunityDebateRequest(body);
    assertUuid(input.opponentMemberId, "opponentMemberId");
    return this.debatesService.startCommunityDebate(
      communityId,
      principal.memberId,
      input.opponentMemberId,
    );
  }

  @Get("active")
  async active(
    @Param("communityId") communityId: string,
    @CurrentMember() principal: AuthPrincipal,
  ): Promise<DebateDetailDto | null> {
    assertUuid(communityId, "communityId");
    return this.debatesService.getActiveCommunityDebate(
      communityId,
      principal.memberId,
    );
  }
}
