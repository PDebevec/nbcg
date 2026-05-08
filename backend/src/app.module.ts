import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from './core/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ImportModule } from './modules/import/import.module';
import { RelationsModule } from './modules/relations/relations.module';
import { ItemsModule } from './modules/items/items.module';
import { FilesModule } from './modules/files/files.module';
import { SearchModule } from './modules/search/search.module';
import { PrismaModule } from './core/prisma/prisma.module';
import { SeaweedfsModule } from './core/seaweedfs/seaweedfs.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379'),
      },
    }),
    PrismaModule,
    SeaweedfsModule,
    AuthModule,
    HealthModule,
    ImportModule,
    RelationsModule,
    ItemsModule,
    FilesModule,
    SearchModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}