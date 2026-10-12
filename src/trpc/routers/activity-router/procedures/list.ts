import { withAccessControl } from "@/trpc/api/trpc";
import type { ViewKind } from "@prisma/client";
import { ZodActivityListSchema } from "../schema";

const canRead = (
  perms: { subject: string; actions: string[] }[],
  subject: string,
) =>
  perms.some(
    (p) =>
      p.subject === subject &&
      (p.actions.includes("read") || p.actions.includes("*")),
  );

export const listActivityProcedure = withAccessControl
  .meta({ policies: { audits: { allow: ["read"] } } })
  .input(ZodActivityListSchema)
  .query(async ({ ctx, input }) => {
    const { db } = ctx.tenant;
    const canSeeHoldings = canRead(ctx.permissions, "securities");
    const empty = { items: [], nextCursor: null, canSeeHoldings };

    // resolve an optional target filter inside the tenant
    let targetId: string | undefined;
    if (input.kind && input.targetPublicId) {
      const where = { publicId: input.targetPublicId };
      const select = { id: true };
      const found =
        input.kind === "DATA_ROOM"
          ? await db.dataRoom.findFirst({ where, select })
          : input.kind === "UPDATE"
            ? await db.update.findFirst({ where, select })
            : await db.template.findFirst({ where, select });
      if (!found) return empty;
      targetId = found.id;
    }

    // Prisma positions a cursor without the where filter: a foreign event id
    // would page this tenant's rows by another tenant's timestamp
    if (
      input.cursor &&
      !(await db.viewEvent.findFirst({
        where: { id: input.cursor },
        select: { id: true },
      }))
    )
      return empty;

    const rows = await db.viewEvent.findMany({
      where: {
        ...(input.kind && { kind: input.kind }),
        ...(targetId && { targetId }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
    });
    const page = rows.slice(0, input.limit);
    const nextCursor =
      rows.length > input.limit ? page[page.length - 1]?.id ?? null : null;

    const ids = (kind: ViewKind, key: "recipientId" | "targetId") => [
      ...new Set(page.filter((r) => r.kind === kind).map((r) => r[key])),
    ];
    const named = { id: true, name: true, email: true };

    // recipients are parent-scoped by the tenant client (dataRoom/update/template)
    const [rooms, updates, templates, roomRecips, updRecips, signRecips] =
      await Promise.all([
        db.dataRoom.findMany({
          where: { id: { in: ids("DATA_ROOM", "targetId") } },
          select: { id: true, name: true },
        }),
        db.update.findMany({
          where: { id: { in: ids("UPDATE", "targetId") } },
          select: { id: true, title: true },
        }),
        db.template.findMany({
          where: { id: { in: ids("ESIGN", "targetId") } },
          select: { id: true, name: true },
        }),
        db.dataRoomRecipient.findMany({
          where: { id: { in: ids("DATA_ROOM", "recipientId") } },
          select: { ...named, stakeholderId: true },
        }),
        db.updateRecipient.findMany({
          where: { id: { in: ids("UPDATE", "recipientId") } },
          select: { ...named, stakeholderId: true },
        }),
        db.esignRecipient.findMany({
          where: { id: { in: ids("ESIGN", "recipientId") } },
          select: named,
        }),
      ]);

    const targetName = new Map<string, string>([
      ...rooms.map((r) => [r.id, r.name] as const),
      ...updates.map((r) => [r.id, r.title] as const),
      ...templates.map((r) => [r.id, r.name] as const),
    ]);
    const recipient = new Map<
      string,
      { name: string | null; email: string; stakeholderId: string | null }
    >([
      ...roomRecips.map((r) => [r.id, r] as const),
      ...updRecips.map((r) => [r.id, r] as const),
      ...signRecips.map((r) => [r.id, { ...r, stakeholderId: null }] as const),
    ]);

    // stakeholders (tenant-scoped): by id for rooms/updates, by email for e-sign
    const emails = [...new Set(signRecips.map((r) => r.email.toLowerCase()))];
    const stakeholderIds = [
      ...new Set(
        [...roomRecips, ...updRecips]
          .map((r) => r.stakeholderId)
          .filter((x): x is string => !!x),
      ),
    ];
    const stakeholders =
      stakeholderIds.length || emails.length
        ? await db.stakeholder.findMany({
            where: {
              OR: [
                { id: { in: stakeholderIds } },
                { email: { in: emails, mode: "insensitive" } },
              ],
            },
            select: { id: true, name: true, email: true },
          })
        : [];
    const byId = new Map(stakeholders.map((s) => [s.id, s]));
    const byEmail = new Map(
      stakeholders.map((s) => [s.email.toLowerCase(), s]),
    );

    const holdings = new Map<string, number>();
    if (canSeeHoldings && stakeholders.length) {
      const sums = await db.share.groupBy({
        by: ["stakeholderId"],
        where: {
          stakeholderId: { in: stakeholders.map((s) => s.id) },
          status: "ACTIVE",
        },
        _sum: { quantity: true },
      });
      for (const s of sums) holdings.set(s.stakeholderId, s._sum.quantity ?? 0);
    }

    const items = page.map((r) => {
      const rec = recipient.get(r.recipientId);
      const st = rec?.stakeholderId
        ? byId.get(rec.stakeholderId)
        : rec
          ? byEmail.get(rec.email.toLowerCase())
          : undefined;
      return {
        id: r.id,
        kind: r.kind,
        targetName: targetName.get(r.targetId) ?? "(deleted)",
        viewer: {
          label: rec?.name || rec?.email || "Unknown recipient",
          email: rec?.email ?? "",
          stakeholder: st
            ? {
                id: st.id,
                name: st.name,
                shares: canSeeHoldings ? holdings.get(st.id) ?? 0 : null,
              }
            : null,
        },
        country: r.country,
        network: r.network,
        timezone: r.timezone,
        createdAt: r.createdAt,
        activeSeconds: r.activeSeconds,
        pageSeconds: (r.pageSeconds ?? {}) as Record<string, number>,
        isBot: r.isBot,
      };
    });

    return { items, nextCursor, canSeeHoldings };
  });
