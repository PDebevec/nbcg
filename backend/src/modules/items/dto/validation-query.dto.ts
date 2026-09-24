import { IsIn, IsOptional } from 'class-validator';
import { ItemType } from '../../../../generated/prisma/enums';

export class ValidationQueryDto {
  /** The state to check against. Only publishing is validated today. */
  @IsOptional()
  @IsIn([ItemType.RECORD])
  target?: typeof ItemType.RECORD = ItemType.RECORD;
}
