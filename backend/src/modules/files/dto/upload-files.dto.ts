import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

/** Coerce multipart form fields (always strings) into a real boolean. */
const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value; // let @IsBoolean reject anything else
};

export class UploadFilesDto {
  /** Run OCR on uploaded PDFs. Defaults to false — only embedded text is extracted. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  doOCR?: boolean = false;
}

export class ReextractDto {
  /** Run OCR during re-extraction. Defaults to true — the endpoint exists to force OCR. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  doOCR?: boolean = true;
}
