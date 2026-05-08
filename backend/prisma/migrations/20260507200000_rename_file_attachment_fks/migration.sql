-- DropForeignKey
ALTER TABLE "file_attachments" DROP CONSTRAINT "file_attachments_draftId_fkey";

-- DropForeignKey
ALTER TABLE "file_attachments" DROP CONSTRAINT "file_attachments_recordId_fkey";

-- DropIndex
DROP INDEX "file_attachments_draftId_idx";

-- DropIndex
DROP INDEX "file_attachments_recordId_idx";

-- AlterTable
ALTER TABLE "file_attachments" RENAME COLUMN "draftId" TO "draft_id";
ALTER TABLE "file_attachments" RENAME COLUMN "recordId" TO "record_id";

-- CreateIndex
CREATE INDEX "file_attachments_draft_id_idx" ON "file_attachments"("draft_id");

-- CreateIndex
CREATE INDEX "file_attachments_record_id_idx" ON "file_attachments"("record_id");

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
