-- CreateEnum
CREATE TYPE "TextExtractionStatus" AS ENUM ('NOT_EXTRACTED', 'EXTRACTED', 'GARBAGE', 'NO_TEXT');

-- AlterTable: add new column with default
ALTER TABLE "file_attachments" ADD COLUMN "textExtractionStatus" "TextExtractionStatus" NOT NULL DEFAULT 'NOT_EXTRACTED';

-- DataMigration: carry over existing boolean state
UPDATE "file_attachments"
SET "textExtractionStatus" = CASE
    WHEN "textExtracted" = true AND "extractedText" IS NOT NULL AND "extractedText" != '' THEN 'EXTRACTED'::"TextExtractionStatus"
    WHEN "textExtracted" = true THEN 'NO_TEXT'::"TextExtractionStatus"
    ELSE 'NOT_EXTRACTED'::"TextExtractionStatus"
END;

-- AlterTable: drop old boolean column
ALTER TABLE "file_attachments" DROP COLUMN "textExtracted";
