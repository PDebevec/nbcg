import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { HealthService } from './health.service';
import { JwtAuthGuard } from '../../auth/auth.guard';

@Controller('health')
//@UseGuards(JwtAuthGuard)
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(@Req() req: any) {
    return {
      ...this.healthService.getStatus(),
      user: {
        sub: req.user.sub,
        username: req.user.preferred_username,
        roles: req.user.realm_access?.roles ?? [],
      },
    };
  }
}
