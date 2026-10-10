-- CreateEnum
CREATE TYPE "DomainKind" AS ENUM ('PLATFORM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('ACTIVE', 'ALIAS', 'RELEASED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CompanyDomain" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "kind" "DomainKind" NOT NULL,
    "status" "DomainStatus" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "aliasExpiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "CompanyDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthHandoff" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "targetHost" TEXT NOT NULL,
    "next" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyDomain_companyId_idx" ON "CompanyDomain"("companyId");

-- CreateIndex
CREATE INDEX "CompanyDomain_hostname_idx" ON "CompanyDomain"("hostname");

-- CreateIndex
CREATE UNIQUE INDEX "AuthHandoff_codeHash_key" ON "AuthHandoff"("codeHash");

-- CreateIndex
CREATE INDEX "AuthHandoff_expiresAt_idx" ON "AuthHandoff"("expiresAt");

-- One live owner per hostname; RELEASED rows keep history.
CREATE UNIQUE INDEX "CompanyDomain_hostname_live_key"
  ON "CompanyDomain" ("hostname") WHERE "status" <> 'RELEASED';
-- One primary per company.
CREATE UNIQUE INDEX "CompanyDomain_company_primary_key"
  ON "CompanyDomain" ("companyId") WHERE "isPrimary";
ALTER TABLE "CompanyDomain"
  ADD CONSTRAINT "CompanyDomain_hostname_lower" CHECK ("hostname" = lower("hostname"));
