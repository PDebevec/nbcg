import { IsArray, IsString, ArrayNotEmpty } from 'class-validator';

export class DeleteItemsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids: string[];
}
