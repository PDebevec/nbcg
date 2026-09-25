import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { TaskKind } from '../../../../generated/prisma/enums';

/** Who gets the task next, and in which stage. */
export class NextStageDto {
  /**
   * FIX_METADATA or REVIEW_PUBLISH — which of those the current stage allows is
   * checked in TasksService.complete(), not here, because it depends on the task.
   */
  @IsEnum(TaskKind)
  kind: TaskKind;

  /** May be the caller — "I'll fix it myself", "I'll publish it myself". */
  @IsString()
  @MinLength(1)
  assignedToUserId: string;
}

/**
 * `POST /tasks/:id/complete` — finish the current stage.
 *
 * | Stage | `next` |
 * |---|---|
 * | GENERAL | optional — without it the task is COMPLETED |
 * | FIX_METADATA | required, `kind: REVIEW_PUBLISH` |
 * | REVIEW_PUBLISH | not allowed — completing it publishes the item |
 */
export class CompleteTaskDto {
  /** Goes onto the history row this writes (for REVIEW_PUBLISH: the CLOSED_ON_PUBLISH row). */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NextStageDto)
  next?: NextStageDto;
}
