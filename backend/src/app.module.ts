import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ImportModule } from './modules/import/import.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379'),
      },
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    ImportModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}