import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { MemberDto } from "../members/dto/member.dto";
import {
  validateLoginMemberRequest,
  validateSignUpMemberRequest,
} from "../members/validators/member-request.validator";
import { AuthService } from "./auth.service";
import { AuthTokenResponseDto } from "./dto/auth.dto";
import { Public } from "./public.decorator";
import { validateRefreshTokenRequest } from "./validators/auth-request.validator";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("signup")
  signUp(@Body() body: unknown): Promise<AuthTokenResponseDto> {
    return this.authService.signUp(validateSignUpMemberRequest(body));
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body() body: unknown): Promise<AuthTokenResponseDto> {
    return this.authService.login(validateLoginMemberRequest(body));
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() body: unknown): Promise<AuthTokenResponseDto> {
    return this.authService.refresh(
      validateRefreshTokenRequest(body).refreshToken,
    );
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(@Body() body: unknown): Promise<void> {
    await this.authService.logout(
      validateRefreshTokenRequest(body).refreshToken,
    );
  }
}
