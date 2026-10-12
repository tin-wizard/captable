-- AlterTable
ALTER TABLE "ViewEvent" ADD COLUMN     "country" TEXT,
ADD COLUMN     "asn" TEXT,
ADD COLUMN     "network" TEXT,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "activeSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pageSeconds" JSONB;

-- AlterTable
ALTER TABLE "DataRoom" ADD COLUMN     "createdById" TEXT;

-- CreateIndex
CREATE INDEX "ViewEvent_companyId_createdAt_idx" ON "ViewEvent"("companyId", "createdAt");
