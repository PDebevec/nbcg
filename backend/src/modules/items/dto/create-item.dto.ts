import { IsArray, IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { ItemType, VisibilityStatus } from '../../../../generated/prisma/enums';

export class CreateItemDto {
  @IsEnum(VisibilityStatus)
  visibilityStatus: VisibilityStatus;

  @IsEnum(ItemType)
  targetState: ItemType;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  /**
   * Parents to link the new item to, in the same transaction. The save check
   * runs with them (an issue of a serial needs its issue data as a RECORD).
   * Duplicates are ignored; an unknown id is `400 PARENT_NOT_FOUND`.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  parentIds?: string[];
}
