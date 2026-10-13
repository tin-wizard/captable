import { z } from "zod";

export const ZodCapTableSchema = z.object({
  classId: z.string().optional(),
  holderType: z.enum(["INDIVIDUAL", "INSTITUTION"]).optional(),
  search: z.string().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(50),
});

export const ZodProformaSchema = z.object({
  preMoney: z.number().finite().positive(),
  newMoney: z.number().finite().min(0),
  poolTargetPct: z.number().min(0).max(0.5),
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (s) => {
        const d = new Date(`${s}T00:00:00Z`);
        return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
      },
      { message: "Invalid date" },
    )
    .optional(),
});
