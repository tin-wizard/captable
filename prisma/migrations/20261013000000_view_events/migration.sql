-- CreateEnum
CREATE TYPE "ViewKind" AS ENUM ('DATA_ROOM', 'UPDATE', 'ESIGN');

-- AlterTable
ALTER TABLE "Member" ADD COLUMN "notifyOnView" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ViewEvent" (
    "id" TEXT NOT NULL,
    "kind" "ViewKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "ViewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ViewEvent_companyId_idx" ON "ViewEvent"("companyId");

-- CreateIndex
CREATE INDEX "ViewEvent_kind_targetId_recipientId_createdAt_idx" ON "ViewEvent"("kind", "targetId", "recipientId", "createdAt");
