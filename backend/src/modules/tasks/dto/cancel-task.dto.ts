import { IsOptional, IsString, MaxLength } from 'class-validator';

/** `POST /tasks/:id/cancel` — CANCELLED is terminal. */
export class CancelTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;
}
