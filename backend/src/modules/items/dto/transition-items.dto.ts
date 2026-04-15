import { IsArray, IsEnum, IsString, ArrayNotEmpty } from 'class-validator';
import { ItemType } from '../../../../generated/prisma/enums';

export class TransitionItemsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids: string[];

  @IsEnum(ItemType)
  targetState: ItemType;
}
