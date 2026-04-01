import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/core/prisma/prisma.module';
import { RelationsController } from './relations.controller';
import { RelationsService } from './relations.service';

@Module({
  imports: [PrismaModule],
  controllers: [RelationsController],
  providers: [RelationsService],
})
export class RelationsModule {}
