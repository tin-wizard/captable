ALTER TYPE "DomainStatus" ADD VALUE 'PENDING';
ALTER TABLE "CompanyDomain" ADD COLUMN "verificationToken" TEXT, ADD COLUMN "verifiedAt" TIMESTAMP(3);
-- A pending claim must not block the real owner: only ACTIVE/ALIAS rows own a hostname.
DROP INDEX "CompanyDomain_hostname_live_key";
CREATE UNIQUE INDEX "CompanyDomain_hostname_live_key"
  ON "CompanyDomain" ("hostname") WHERE "status" IN ('ACTIVE', 'ALIAS');
