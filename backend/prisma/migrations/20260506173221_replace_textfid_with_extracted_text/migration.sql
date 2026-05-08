/*
  Warnings:

  - You are about to drop the column `textFid` on the `file_attachments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "file_attachments" DROP COLUMN "textFid",
ADD COLUMN     "extractedText" TEXT;
