import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { MetricKind } from '../../../../generated/prisma/enums';

/**
 * `from`/`to` are inclusive calendar days in UTC, `YYYY-MM-DD`.
 *
 * A day is the resolution the metrics table stores, so accepting a full
 * timestamp here would promise a precision the data does not have.
 */
export class StatsRangeDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be a YYYY-MM-DD date' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be a YYYY-MM-DD date' })
  to?: string;
}

export class TopItemsQueryDto extends StatsRangeDto {
  /** Omit to get views, downloads and top files in one response. */
  @IsOptional()
  @IsEnum(MetricKind)
  metric?: MetricKind;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

export class UserStatsQueryDto extends StatsRangeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
