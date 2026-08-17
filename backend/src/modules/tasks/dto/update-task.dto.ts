import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TaskKind, TaskStatus } from '../../../../generated/prisma/enums';

/**
 * Every field optional, but not every *combination* legal: the `(kind, status)`
 * assignee guard is re-run against the resulting triple, so returning a
 * REVIEW_PUBLISH task must move `status` and `assignedToUserId` in the same
 * request. Either alone is a 400. See TasksService.update().
 *
 * No `expectedVersion`. Items carry optimistic concurrency because two
 * cataloguers editing one record is a real collision; two people editing one
 * task is not, and a version field on every PATCH is friction the frontend pays
 * for nothing. Deliberate omission.
 */
export class UpdateTaskDto {
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskKind)
  kind?: TaskKind;

  @IsOptional()
  @IsString()
  @MinLength(1)
  assignedToUserId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  /**
   * Why. Goes onto the history row this PATCH writes, not onto the task —
   * "the author field is wrong" is a fact about one handover, not a property of
   * the task, and overwriting it on the next round is what the log exists to
   * prevent.
   *
   * Optional, including on a return. Requiring it would be defensible — a
   * return with no reason is a bug report with no body — but that is a product
   * call, not a plumbing one.
   */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;
}
