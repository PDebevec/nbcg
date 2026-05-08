-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('IMAGE', 'PDF');

-- CreateTable
CREATE TABLE "file_attachments" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fileType" "FileType" NOT NULL,
    "originalFid" TEXT NOT NULL,
    "textFid" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "textExtracted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_attachments_itemId_idx" ON "file_attachments"("itemId");
