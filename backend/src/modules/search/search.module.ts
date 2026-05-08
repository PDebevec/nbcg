import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { OpenSearchModule } from '../../core/opensearch/opensearch.module';

@Module({
  imports: [OpenSearchModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
