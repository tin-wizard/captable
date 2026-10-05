-- Stakeholder.email was unique across ALL companies: one person could not be
-- a stakeholder of two companies, and the unique violation told one tenant
-- that the email exists in another. It is now unique per company.
-- The old global index guarantees no (companyId, email) duplicates exist, so
-- creating the new index cannot fail on existing rows. It is created before
-- the old one is dropped so uniqueness is never unenforced.

-- CreateIndex
CREATE UNIQUE INDEX "Stakeholder_companyId_email_key" ON "Stakeholder"("companyId", "email");

-- DropIndex
DROP INDEX "Stakeholder_email_key";
