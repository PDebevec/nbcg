import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** `POST /tasks/:id/reassign` — same stage, different person (never yourself). */
export class ReassignTaskDto {
  @IsString()
  @MinLength(1)
  assignedToUserId: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;
}
