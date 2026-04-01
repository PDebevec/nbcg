import { IsArray, IsString, ArrayNotEmpty } from 'class-validator';

export class ModifyRelationsDto {
  @IsString()
  parentId: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  childIds: string[];
}
