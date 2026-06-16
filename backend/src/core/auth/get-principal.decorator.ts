import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Principal } from './principal.type';

export const GetPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    return ctx.switchToHttp().getRequest().principal;
  },
);
