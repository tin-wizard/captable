import { z } from "zod";

export const ZodActivityListSchema = z.object({
  kind: z.enum(["DATA_ROOM", "UPDATE", "ESIGN"]).optional(),
  targetPublicId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(25),
});
