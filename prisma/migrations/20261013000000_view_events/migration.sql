-- CreateEnum
CREATE TYPE "ViewEventKind" AS ENUM ('DATA_ROOM', 'DATA_ROOM_DOCUMENT', 'UPDATE');

-- CreateTable
CREATE TABLE "ViewEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "ViewEventKind" NOT NULL,
    "dataRoomId" TEXT,
    "bucketId" TEXT,
    "updateId" TEXT,
    "recipientId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ViewEvent_companyId_idx" ON "ViewEvent"("companyId");

-- CreateIndex
CREATE INDEX "ViewEvent_dataRoomId_viewedAt_idx" ON "ViewEvent"("dataRoomId", "viewedAt");

-- CreateIndex
CREATE INDEX "ViewEvent_updateId_viewedAt_idx" ON "ViewEvent"("updateId", "viewedAt");

