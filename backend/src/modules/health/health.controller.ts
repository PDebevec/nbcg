import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { HealthService } from './health.service';
import { JwtAuthGuard } from '../../core/auth/auth.guard';

@Controller('health')
//@UseGuards(JwtAuthGuard)
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(@Req() req: any) {
    return {
      ...this.healthService.getStatus(),
    };
  }
}
