import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { CurrentMember } from "../auth/current-member.decorator";
import { AuthPrincipal } from "../auth/dto/auth.dto";
import { assertUuid } from "../common/http/id.validator";
import { MemberDto } from "./dto/member.dto";
import { MembersService } from "./members.service";
import {
  validateCreateMemberRequest,
  validateUpdateMemberRequest,
} from "./validators/member-request.validator";

@Controller("members")
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Post()
  async createMember(@Body() body: unknown): Promise<MemberDto> {
    return this.membersService.createMember(validateCreateMemberRequest(body));
  }

  @Get()
  async listMembers(): Promise<MemberDto[]> {
    return this.membersService.listMembers();
  }

  @Get(":memberId")
  async getMember(@Param("memberId") memberId: string): Promise<MemberDto> {
    assertUuid(memberId, "memberId");

    return this.membersService.getMember(memberId);
  }

  @Patch(":memberId")
  async updateMember(
    @Param("memberId") memberId: string,
    @CurrentMember() principal: AuthPrincipal,
    @Body() body: unknown,
  ): Promise<MemberDto> {
    assertUuid(memberId, "memberId");
    assertSelf(memberId, principal);

    return this.membersService.updateMember(
      memberId,
      validateUpdateMemberRequest(body),
    );
  }

  @Delete(":memberId")
  @HttpCode(204)
  async deleteMember(
    @Param("memberId") memberId: string,
    @CurrentMember() principal: AuthPrincipal,
  ): Promise<void> {
    assertUuid(memberId, "memberId");
    assertSelf(memberId, principal);

    await this.membersService.deleteMember(memberId);
  }
}

function assertSelf(memberId: string, principal: AuthPrincipal): void {
  if (memberId !== principal.memberId) {
    throw new ForbiddenException("A member can only modify their own account.");
  }
}
