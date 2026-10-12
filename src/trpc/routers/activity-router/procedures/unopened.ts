import { findUnopened } from "@/server/activity/unopened";
import { withAccessControl } from "@/trpc/api/trpc";
import { z } from "zod";

export const unopenedProcedure = withAccessControl
  .meta({ policies: { audits: { allow: ["read"] } } })
  .input(
    z.object({
      kind: z.enum(["DATA_ROOM", "UPDATE"]).optional(),
      targetPublicId: z.string().optional(),
    }),
  )
  .query(async ({ ctx, input }) => {
    const { db, companyId } = ctx.tenant;
    let targetId: string | undefined;
    if (input.kind && input.targetPublicId) {
      const where = { publicId: input.targetPublicId };
      const found =
        input.kind === "DATA_ROOM"
          ? await db.dataRoom.findFirst({ where, select: { id: true } })
          : await db.update.findFirst({ where, select: { id: true } });
      if (!found) return { items: [] };
      targetId = found.id;
    }
    return {
      items: await findUnopened(db, companyId, { kind: input.kind, targetId }),
    };
  });
