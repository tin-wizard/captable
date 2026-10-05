-- READ-ONLY pre-deploy report for migration 20261005123250_bucket_company_owner.
-- Run on production BEFORE deploying. Lists the buckets the backfill will
-- leave without an owner (unusable by every tenant until an operator assigns
-- "Bucket"."companyId" by hand), grouped by reason. It reads only existing
-- columns, so it works before the migration has added "Bucket"."companyId".
--   orphan              no Document/Template references the bucket
--   key-prefix mismatch one referencing company, but the key's first segment
--                       is neither its publicId, its id, nor 'templates'
--   multi-company       several referencing companies, and not exactly one of
--                       them matches the key's first segment
WITH refs AS (
  SELECT "bucketId", "companyId" FROM "Document"
  UNION
  SELECT "bucketId", "companyId" FROM "Template"
),
per_bucket AS (
  SELECT
    b."id",
    split_part(b."key", '/', 1) AS head,
    COUNT(r."companyId") AS companies,
    COUNT(c."id") AS matches
  FROM "Bucket" b
  LEFT JOIN refs r ON r."bucketId" = b."id"
  LEFT JOIN "Company" c
    ON c."id" = r."companyId"
   AND split_part(b."key", '/', 1) IN (c."publicId", c."id")
  GROUP BY b."id", b."key"
),
classified AS (
  SELECT
    "id",
    CASE
      WHEN companies = 0 THEN 'orphan'
      WHEN companies = 1 AND (matches = 1 OR head = 'templates') THEN NULL
      WHEN companies = 1 THEN 'key-prefix mismatch'
      WHEN matches = 1 THEN NULL
      ELSE 'multi-company'
    END AS reason
  FROM per_bucket
)
SELECT reason, COUNT(*) AS buckets, array_agg("id" ORDER BY "id") AS bucket_ids
FROM classified
WHERE reason IS NOT NULL
GROUP BY reason
ORDER BY reason;
