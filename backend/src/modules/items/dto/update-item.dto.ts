import { IsEnum, IsObject, IsOptional } from 'class-validator';
import { VisibilityStatus } from '../../../../generated/prisma/enums';

export class UpdateItemDto {
  @IsOptional()
  @IsEnum(VisibilityStatus)
  visibilityStatus?: VisibilityStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
