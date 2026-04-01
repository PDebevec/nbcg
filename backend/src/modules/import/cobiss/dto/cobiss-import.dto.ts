import { IsArray, IsEnum, IsString, ArrayNotEmpty } from 'class-validator';
import { ItemType, VisibilityStatus } from '../../../../../generated/prisma/enums';

export class CobissImportDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids: string[];

  @IsEnum(ItemType)
  target: ItemType;

  @IsEnum(VisibilityStatus)
  visibilityStatus: VisibilityStatus;
}
