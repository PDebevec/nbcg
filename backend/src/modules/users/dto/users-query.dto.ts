import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Transform } from 'class-transformer';

export class UsersQueryDto {
  /**
   * Filter to a capability rather than a role or group name. `publish` means
   * `records:manage` AND `drafts:manage` — so it includes `editor` and excludes
   * `cataloguer`, which is the inverse of how those roles sound.
   */
  @IsOptional()
  @IsEnum(['publish'])
  capability?: 'publish';

  /**
   * Active means enabled in Keycloak and still present at the last successful
   * sync. Defaults to true: a picker showing departed staff is a bug.
   */
  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  active?: boolean = true;

  /** Case-insensitive substring over display name, username and email. */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 100;
}
