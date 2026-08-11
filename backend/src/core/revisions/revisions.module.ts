import { Global, Module } from '@nestjs/common';
import { RevisionsService } from './revisions.service';

@Global() // items, files, relations and import all append revisions
@Module({
  providers: [RevisionsService],
  exports: [RevisionsService],
})
export class RevisionsModule {}
