import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Global() // search and files record hits; stats reads them back
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
