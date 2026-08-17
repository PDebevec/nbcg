import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TaskKind } from '../../../../generated/prisma/enums';

export class CreateTaskDto {
  /** The draft or record this is about. Validated by assertCanView — 404, not 403. */
  @IsString()
  @MinLength(1)
  itemId: string;

  /**
   * Defaults to GENERAL rather than REVIEW_PUBLISH: the permissive kind is the
   * safe default, since the assignee guard is strictest for REVIEW_PUBLISH.
   */
  @IsOptional()
  @IsEnum(TaskKind)
  kind?: TaskKind = TaskKind.GENERAL;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsString()
  @MinLength(1)
  assignedToUserId: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}
