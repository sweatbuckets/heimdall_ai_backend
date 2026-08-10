import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthPrincipal } from "./dto/auth.dto";

export const CurrentMember = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    return context.switchToHttp().getRequest<{ user: AuthPrincipal }>().user;
  },
);
