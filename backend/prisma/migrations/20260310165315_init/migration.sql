-- CreateEnum
CREATE TYPE "VisibilityStatus" AS ENUM ('PUBLIC', 'PRIVATE', 'HIDDEN');

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
    "parentType" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "childType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_relations_pkey" PRIMARY KEY ("parentId","parentType","childId","childType")
);

-- CreateIndex
CREATE INDEX "item_relations_parentId_parentType_idx" ON "item_relations"("parentId", "parentType");

-- CreateIndex
CREATE INDEX "item_relations_childId_childType_idx" ON "item_relations"("childId", "childType");

-- CreateIndex
CREATE INDEX "item_relations_childId_childType_parentType_idx" ON "item_relations"("childId", "childType", "parentType");

-- AddForeignKey
ALTER TABLE "item_relations" ADD CONSTRAINT "parent_draft_fk" FOREIGN KEY ("parentId") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_relations" ADD CONSTRAINT "child_draft_fk" FOREIGN KEY ("childId") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_relations" ADD CONSTRAINT "parent_record_fk" FOREIGN KEY ("parentId") REFERENCES "records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_relations" ADD CONSTRAINT "child_record_fk" FOREIGN KEY ("childId") REFERENCES "records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
