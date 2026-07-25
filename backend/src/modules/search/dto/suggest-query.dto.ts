import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SuggestQueryDto {
  /** Field to get suggestions for (from the supported allowlist) */
  @IsString()
  field: string;

  /** Partial text for typeahead filtering. If omitted, returns top values by frequency. */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;

  @IsOptional()
  @IsEnum(['all', 'records', 'drafts'])
  type?: 'all' | 'records' | 'drafts' = 'all';
}
