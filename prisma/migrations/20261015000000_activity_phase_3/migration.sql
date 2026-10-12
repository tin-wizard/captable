-- AlterTable
ALTER TABLE "DataRoomRecipient" ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "lastNudgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UpdateRecipient" ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "lastNudgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Member" ADD COLUMN "viewDigest" BOOLEAN NOT NULL DEFAULT false;
