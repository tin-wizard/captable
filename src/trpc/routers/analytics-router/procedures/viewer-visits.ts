import { withAccessControl } from "@/trpc/api/trpc";
import { ZodViewerVisitsSchema } from "../schema";
import { assertSourceRead, resolveTarget } from "./target";

// One recipient's visits to one room or update, newest first (for the viewer
// side sheet). The target is resolved inside the tenant and the events are
// filtered by it, so another company's recipient id returns nothing.
export const viewerVisitsProcedure = withAccessControl
  .meta({ policies: { audits: { allow: ["read"] } } })
  .input(ZodViewerVisitsSchema)
  .query(async ({ ctx, input }) => {
    assertSourceRead(ctx.permissions, input.kind);
    const { db } = ctx.tenant;
    const targetId = await resolveTarget(
      db as never,
      input.kind,
      input.targetPublicId,
    );
    if (!targetId) return { items: [] };

    const rows = await db.viewEvent.findMany({
      where: {
        kind: input.kind,
        targetId,
        recipientId: input.recipientId,
        isBot: false,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true,
        createdAt: true,
        activeSeconds: true,
        pageSeconds: true,
        country: true,
        network: true,
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        activeSeconds: r.activeSeconds,
        pageSeconds: (r.pageSeconds ?? {}) as Record<string, number>,
        country: r.country,
        network: r.network,
      })),
    };
  });
