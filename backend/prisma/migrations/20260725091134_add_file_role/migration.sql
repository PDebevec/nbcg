-- CreateEnum
CREATE TYPE "FileRole" AS ENUM ('SOURCE', 'ARCHIVAL', 'WEB', 'THUMBNAIL');

-- AlterTable
ALTER TABLE "file_attachments" ADD COLUMN     "role" "FileRole" NOT NULL DEFAULT 'SOURCE';
