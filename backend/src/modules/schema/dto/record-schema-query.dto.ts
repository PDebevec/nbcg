import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

export class RecordSchemaQueryDto {
  // `?level=` with no value has always meant "all fields" — keep that.
  // Anything else that isn't `main`/`child` is a 400, so an unrecognised
  // level can never be answered with a cacheable empty field list.
  @Transform(({ value }: { value: unknown }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsIn(['main', 'child'])
  level?: 'main' | 'child';
}
