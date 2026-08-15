import { IsEnum, IsOptional, IsString } from 'class-validator';
import { FileRole } from '../../../../generated/prisma/enums';

export class UploadFilesDto {
  /**
   * Pre-extracted text for uploaded PDFs, as a JSON map: `{ "filename.pdf": "extracted text..." }`.
   * When text is supplied for a file, the backend stores it directly.
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
  /** Pre-extracted text for the replacement file, stored directly when supplied. */
  @IsOptional()
  @IsString()
  extractedText?: string;
}
