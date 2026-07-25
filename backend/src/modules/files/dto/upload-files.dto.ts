import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { FileRole } from '../../../../generated/prisma/enums';

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

  /**
   * Pre-extracted text for uploaded PDFs, as a JSON map: `{ "filename.pdf": "extracted text..." }`.
   * When text is supplied for a file, the backend stores it directly and skips Tika extraction.
   * Sent as a string (JSON-encoded) in multipart form data; parsed in the service layer.
   */
  @IsOptional()
  @IsString()
  extractedTexts?: string;

  /** Role/variant of the uploaded files: SOURCE (default), ARCHIVAL, WEB, or THUMBNAIL. */
  @IsOptional()
  @IsEnum(FileRole)
  role?: FileRole;
}

export class SetTextDto {
  /** The extracted text to store for this file attachment. */
  @IsString()
  text: string;
}

export class ReplaceFileDto {
  /** Run OCR on the replacement PDF. Defaults to false. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  doOCR?: boolean = false;

  /** Pre-extracted text for the replacement file. When supplied, Tika extraction is skipped. */
  @IsOptional()
  @IsString()
  extractedText?: string;
}

export class ReextractDto {
  /** Run OCR during re-extraction. Defaults to true — the endpoint exists to force OCR. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  doOCR?: boolean = true;
}
