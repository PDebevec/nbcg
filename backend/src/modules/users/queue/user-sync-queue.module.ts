import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { KeycloakModule } from '../../../core/keycloak/keycloak.module';
import { UserSyncService } from '../user-sync.service';
import { UserSyncProcessor } from './user-sync.processor';
import { USER_SYNC_QUEUE, UserSyncQueueService } from './user-sync-queue.service';

@Module({
  imports: [BullModule.registerQueue({ name: USER_SYNC_QUEUE }), KeycloakModule],
  providers: [UserSyncQueueService, UserSyncProcessor, UserSyncService],
  exports: [UserSyncQueueService, UserSyncService],
})
export class UserSyncQueueModule {}
