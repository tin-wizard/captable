-- AlterTable
ALTER TABLE "Bucket" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "Bucket_companyId_idx" ON "Bucket"("companyId");

-- Backfill. A reference alone does not prove ownership (the old open
-- document.create let any company link any bucket), so the key must agree.
-- Legacy key shapes: "<company publicId>/..." (browser uploads),
-- "<company id>/..." (e-sign) and "templates/..." (SAFE templates).
-- Everything else stays NULL (unusable by every tenant until an operator
-- assigns it); docs/bucket-owner-backfill-report.sql lists those buckets.
-- Both passes only touch NULL owners, so re-running them changes nothing.

-- Pass 1: exactly one company references the bucket, and the key's first
-- segment is that company's publicId or id, or 'templates'.
UPDATE "Bucket" b
SET "companyId" = refs."companyId"
FROM (
  SELECT "bucketId", MIN("companyId") AS "companyId"
  FROM (
    SELECT "bucketId", "companyId" FROM "Document"
    UNION ALL
    SELECT "bucketId", "companyId" FROM "Template"
  ) r
  GROUP BY "bucketId"
  HAVING COUNT(DISTINCT "companyId") = 1
) refs
JOIN "Company" c ON c."id" = refs."companyId"
WHERE b."id" = refs."bucketId"
  AND b."companyId" IS NULL
  AND split_part(b."key", '/', 1) IN (c."publicId", c."id", 'templates');

-- Pass 2: several companies reference the bucket; the owner is the one
-- referencing company whose publicId or id is the key's first segment, if
-- exactly one matches.
UPDATE "Bucket" b
SET "companyId" = m."companyId"
FROM (
  SELECT r."bucketId", MIN(c."id") AS "companyId"
  FROM (
    SELECT "bucketId", "companyId" FROM "Document"
    UNION
    SELECT "bucketId", "companyId" FROM "Template"
  ) r
  JOIN "Bucket" k ON k."id" = r."bucketId"
  JOIN "Company" c
    ON c."id" = r."companyId"
   AND split_part(k."key", '/', 1) IN (c."publicId", c."id")
  WHERE r."bucketId" IN (
    SELECT "bucketId"
    FROM (
      SELECT "bucketId", "companyId" FROM "Document"
      UNION ALL
      SELECT "bucketId", "companyId" FROM "Template"
    ) all_refs
    GROUP BY "bucketId"
    HAVING COUNT(DISTINCT "companyId") > 1
  )
  GROUP BY r."bucketId"
  HAVING COUNT(DISTINCT c."id") = 1
) m
WHERE b."id" = m."bucketId"
  AND b."companyId" IS NULL;
