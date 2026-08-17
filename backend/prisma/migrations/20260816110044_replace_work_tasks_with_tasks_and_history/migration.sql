/*
  Warnings:

  - You are about to drop the `task_comments` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `work_tasks` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "TaskAction" AS ENUM ('CREATED', 'ASSIGNED', 'STATUS_CHANGED', 'RETURNED', 'COMMENTED', 'UPDATED', 'CLOSED_ON_PUBLISH');

-- DropForeignKey
ALTER TABLE "task_comments" DROP CONSTRAINT "task_comments_taskId_fkey";

-- DropTable
DROP TABLE "task_comments";

-- DropTable
DROP TABLE "work_tasks";

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "TaskKind" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToUserId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "dueAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_history" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "action" "TaskAction" NOT NULL,
    "note" TEXT,
    "changes" JSONB,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_assignedToUserId_status_idx" ON "tasks"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "tasks_createdByUserId_status_idx" ON "tasks"("createdByUserId", "status");

-- CreateIndex
CREATE INDEX "tasks_itemId_idx" ON "tasks"("itemId");

-- CreateIndex
CREATE INDEX "task_history_taskId_createdAt_idx" ON "task_history"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "task_history_itemId_createdAt_idx" ON "task_history"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "task_history_userId_createdAt_idx" ON "task_history"("userId", "createdAt");
