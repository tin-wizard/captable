-- Per-document page time for data room visits (additive; legacy rows stay NULL)
ALTER TABLE "ViewEvent" ADD COLUMN "docSeconds" JSONB;
