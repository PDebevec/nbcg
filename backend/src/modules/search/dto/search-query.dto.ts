import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(['all', 'records', 'drafts'])
  type?: 'all' | 'records' | 'drafts' = 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  // Text filters
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  publisher?: string;

  @IsOptional()
  @IsString()
  series?: string;

  // Year: "1990" or "1990-2000"
  @IsOptional()
  @IsString()
  year?: string;

  // Coded fields
  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  materialType?: string;

  // Exact identifiers
  @IsOptional()
  @IsString()
  isbn?: string;

  @IsOptional()
  @IsString()
  issn?: string;

  @IsOptional()
  @IsString()
  cobissId?: string;
}
