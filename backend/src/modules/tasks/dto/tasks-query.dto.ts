import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { TaskKind, TaskStatus } from '../../../../generated/prisma/enums';

/** Guards the badge query against a caller posting an unbounded id list. */
const MAX_ITEM_IDS = 200;

export class TasksQueryDto {
  /** `me` resolves to the caller's sub; a literal user id is also accepted. */
  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  createdBy?: string;

  @IsOptional()
  @IsString()
  itemId?: string;

  /**
   * Comma-separated. Feeds the "has an open task" badge: the GUI renders a page
   * of items, then makes one call with that page's ids. Capped at
   * {@link MAX_ITEM_IDS} — a page is at most a few dozen, so anything larger is
   * not the badge.
   */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map((s) => s.trim()).filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(MAX_ITEM_IDS)
  @IsString({ each: true })
  itemIds?: string[];

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskKind)
  kind?: TaskKind;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
