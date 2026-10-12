import { resolveRecipient } from "@/server/activity/resolve-recipient";
import { db } from "@/server/db";
import { z } from "zod";

const MAX_ACTIVE = 24 * 3600;
const MAX_PAGE = 3600;
const GRACE_SECONDS = 60;

const bodySchema = z.object({
  kind: z.enum(["DATA_ROOM", "UPDATE", "ESIGN"]),
  token: z.string().min(1).max(4096),
  visitId: z.string().min(1).max(64),
  activeSeconds: z.number().int().min(0).max(MAX_ACTIVE),
  pageSeconds: z
    .record(
      z.string().regex(/^[1-9]\d{0,3}$/),
      z.number().int().min(0).max(MAX_PAGE),
    )
    .refine((r) => Object.keys(r).length <= 500),
});

export const POST = async (req: Request) => {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  const { kind, token, visitId, activeSeconds, pageSeconds } = body.data;

  const found = await resolveRecipient(kind, token);
  if (!found) return new Response(null, { status: 404 });

  // the visit must be this recipient's, on this target, in this company
  const row = await db.viewEvent.findFirst({
    where: {
      id: visitId,
      kind,
      targetId: found.targetId,
      recipientId: found.recipientId,
      companyId: found.companyId,
    },
    select: {
      id: true,
      createdAt: true,
      activeSeconds: true,
      pageSeconds: true,
    },
  });
  if (!row) return new Response(null, { status: 404 });

  // nothing can have lasted longer than the visit has existed (plus a grace)
  const ceiling =
    Math.floor((Date.now() - row.createdAt.getTime()) / 1000) + GRACE_SECONDS;
  const stored = (row.pageSeconds ?? {}) as Record<string, number>;
  const merged: Record<string, number> = { ...stored };
  for (const [page, secs] of Object.entries(pageSeconds)) {
    merged[page] = Math.max(stored[page] ?? 0, Math.min(secs, ceiling));
  }

  await db.viewEvent.update({
    where: { id: row.id },
    data: {
      activeSeconds: Math.max(
        row.activeSeconds,
        Math.min(activeSeconds, ceiling),
      ),
      pageSeconds: merged,
    },
  });
  return new Response(null, { status: 204 });
};
