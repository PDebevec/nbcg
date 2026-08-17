import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchQueryDto {
  /** General search — fuzzy per-word AND across title, subtitle, authors, notes, filenames */
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

  // ── Text filters (fuzzy, operator AND — contribute to scoring) ──

  /** Title — fuzzy per-word AND on metadata.title */
  @IsOptional()
  @IsString()
  title?: string;

  /** Author — fuzzy per-word AND on familyName / firstName */
  @IsOptional()
  @IsString()
  author?: string;

  /** Full-text — searches inside extracted PDF text (nested, operator AND) */
  @IsOptional()
  @IsString()
  fullText?: string;

  // ── Multi-select exact filters (comma-separated, filter context) ──

  /** Publisher — comma-separated exact values */
  @IsOptional()
  @IsString()
  publisher?: string;

  /** Language — comma-separated language name values (metadata.language.en) */
  @IsOptional()
  @IsString()
  language?: string;

  /** Material type — comma-separated type name values (metadata.materialType.en) */
  @IsOptional()
  @IsString()
  materialType?: string;

  // ── Range filters ──

  /** Publication year start (YYYY) */
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'yearFrom must be YYYY' })
  yearFrom?: string;

  /** Publication year end (YYYY) */
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'yearTo must be YYYY' })
  yearTo?: string;

  // ── Exact identifiers ──

  @IsOptional()
  @IsString()
  isbn?: string;

  @IsOptional()
  @IsString()
  issn?: string;

  @IsOptional()
  @IsString()
  cobissId?: string;

  /**
   * Exact filter on `createdByUserId`. A user id, not a name: the snapshot name
   * is frozen on purpose, so filtering by name would miss renamed users. Not
   * always a UUID (system imports use a sentinel id), hence plain IsString.
   */
  @IsOptional()
  @IsString()
  createdBy?: string;

  // ── Response shape ──

  /** Comma-separated field names to include in the response. If omitted, all fields are returned. `id` is always included. */
  @IsOptional()
  @IsString()
  fields?: string;

  @IsOptional()
  @IsEnum(['relevance', 'newest'])
  sort?: 'relevance' | 'newest' = 'relevance';
}
