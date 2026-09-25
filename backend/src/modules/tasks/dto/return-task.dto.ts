import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** `POST /tasks/:id/return` — back one step on the handoff stack. */
export class ReturnTaskDto {
  /** Required: a return without a reason is a bug report without a body. */
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  @Matches(/\S/, { message: 'note must not be blank' })
  note: string;

  /**
   * Overrides the PERSON it goes back to (the previous holder has left, is on
   * leave…), never the stage.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  assignedToUserId?: string;
}
