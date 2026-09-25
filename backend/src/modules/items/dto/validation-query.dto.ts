import { IsIn, IsOptional } from 'class-validator';
import { ItemType } from '../../../../generated/prisma/enums';

export class ValidationQueryDto {
  /** Whose rules to check against: RECORD (can it be published?) or DRAFT. */
  @IsOptional()
  @IsIn([ItemType.DRAFT, ItemType.RECORD])
  target?: ItemType = ItemType.RECORD;
}
