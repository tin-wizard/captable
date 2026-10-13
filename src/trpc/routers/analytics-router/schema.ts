import { z } from "zod";

export const ZodRange = {
  range: z.enum(["7d", "30d", "90d", "custom"]).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
};

export const ZodDocumentTarget = {
  kind: z.enum(["DATA_ROOM", "UPDATE"]),
  targetPublicId: z.string().min(1).max(64),
};

export const ZodDocumentAnalyticsSchema = z.object({
  ...ZodDocumentTarget,
  ...ZodRange,
  includeBots: z.boolean().optional(),
  viewerStatus: z.enum(["all", "returned", "unopened"]).optional(),
  country: z.array(z.string().length(2)).max(20).optional(),
  search: z.string().max(100).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const ZodDocumentsSummarySchema = z.object({
  kind: z.enum(["DATA_ROOM", "UPDATE"]),
  ...ZodRange,
});

export const ZodViewerVisitsSchema = z.object({
  ...ZodDocumentTarget,
  recipientId: z.string().min(1).max(64),
});
