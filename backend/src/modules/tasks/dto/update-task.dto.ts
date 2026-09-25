import { IsDateString, IsEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const USE_ACTIONS =
  'is not editable through PATCH — use POST /api/tasks/:id/complete, /return, /reassign or /cancel';

/**
 * `PATCH /tasks/:id` — the task's details only. Where the task is (status,
 * stage, assignee) moves only through the action routes, each of which writes
 * exactly one history row with its own label.
 *
 * `status`, `kind`, `assignedToUserId` and `note` are declared only to be
 * REJECTED with a pointer to the right route: the global ValidationPipe strips
 * unknown keys silently, and a v1 client's "complete" PATCH quietly returning
 * 200 while doing nothing would be worse than a 400.
 *
 * No `expectedVersion`. Items carry optimistic concurrency because two
 * cataloguers editing one record is a real collision; two people editing one
 * task's title is not.
 */
export class UpdateTaskDto {
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

  @IsEmpty({ message: `status ${USE_ACTIONS}` })
  status?: never;

  @IsEmpty({ message: `kind ${USE_ACTIONS}` })
  kind?: never;

  @IsEmpty({ message: `assignedToUserId ${USE_ACTIONS}` })
  assignedToUserId?: never;

  @IsEmpty({ message: 'note is not accepted by PATCH — use POST /api/tasks/:id/comments' })
  note?: never;
}
