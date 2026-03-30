-- CreateEnum
CREATE TYPE "VisibilityStatus" AS ENUM ('PUBLIC', 'PRIVATE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('DRAFT', 'RECORD');

-- CreateTable
CREATE TABLE "drafts" (
    "id" TEXT NOT NULL,
    "visibilityStatus" "VisibilityStatus" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "records" (
    "id" TEXT NOT NULL,
    "visibilityStatus" "VisibilityStatus" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_relations" (
    "parentId" TEXT NOT NULL,
    "parentType" "ItemType" NOT NULL,
    "childId" TEXT NOT NULL,
    "childType" "ItemType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_relations_pkey" PRIMARY KEY ("parentId","childId")
);

-- CreateIndex
CREATE INDEX "item_relations_parentId_parentType_idx" ON "item_relations"("parentId", "parentType");

-- CreateIndex
CREATE INDEX "item_relations_childId_childType_idx" ON "item_relations"("childId", "childType");
