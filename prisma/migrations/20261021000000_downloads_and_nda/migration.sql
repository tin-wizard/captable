ALTER TABLE "DataRoom" ADD COLUMN "allowDownload" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "requireNda" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Update" ADD COLUMN "requireNda" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN "ndaText" TEXT;

CREATE TABLE "NdaAcceptance" (
  "id" TEXT NOT NULL,
  "kind" "ViewKind" NOT NULL,
  "targetId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "ip" TEXT NOT NULL,
  "userAgent" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "companyId" TEXT NOT NULL,
  CONSTRAINT "NdaAcceptance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NdaAcceptance_kind_targetId_recipientId_key" ON "NdaAcceptance"("kind", "targetId", "recipientId");
CREATE INDEX "NdaAcceptance_companyId_idx" ON "NdaAcceptance"("companyId");

CREATE TABLE "DownloadEvent" (
  "id" TEXT NOT NULL,
  "kind" "ViewKind" NOT NULL,
  "targetId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "bucketId" TEXT NOT NULL,
  "ip" TEXT NOT NULL,
  "userAgent" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "companyId" TEXT NOT NULL,
  CONSTRAINT "DownloadEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DownloadEvent_companyId_createdAt_idx" ON "DownloadEvent"("companyId", "createdAt");
