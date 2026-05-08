/*
  Warnings:

  - You are about to drop the column `itemId` on the `file_attachments` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "file_attachments_itemId_idx";

-- AlterTable
ALTER TABLE "file_attachments" DROP COLUMN "itemId",
ADD COLUMN     "draftId" TEXT,
ADD COLUMN     "recordId" TEXT;

-- CreateIndex
CREATE INDEX "file_attachments_draftId_idx" ON "file_attachments"("draftId");

-- CreateIndex
CREATE INDEX "file_attachments_recordId_idx" ON "file_attachments"("recordId");

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
