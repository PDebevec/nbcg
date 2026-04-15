import { IsEnum, IsObject, IsOptional } from 'class-validator';
import { ItemType, VisibilityStatus } from '../../../../generated/prisma/enums';

export class CreateItemDto {
  @IsEnum(VisibilityStatus)
  visibilityStatus: VisibilityStatus;

  @IsEnum(ItemType)
  targetState: ItemType;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
