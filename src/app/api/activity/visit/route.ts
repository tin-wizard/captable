import {
  type DocSeconds,
  MAX_DOCS,
  MAX_DOC_PAGES,
  mergeDocSeconds,
} from "@/server/activity/doc-seconds";
import { resolveRecipient } from "@/server/activity/resolve-recipient";
import { db } from "@/server/db";
import { z } from "zod";

const MAX_ACTIVE = 24 * 3600;
const MAX_PAGE = 3600;
const GRACE_SECONDS = 60;

const pageSecondsSchema = z
  .record(
    z.string().regex(/^[1-9]\d{0,3}$/),
    z.number().int().min(0).max(MAX_PAGE),
  )
  .refine((r) => Object.keys(r).length <= MAX_DOC_PAGES);

const bodySchema = z.object({
  kind: z.enum(["DATA_ROOM", "UPDATE", "ESIGN"]),
  token: z.string().min(1).max(4096),
  visitId: z.string().min(1).max(64),
  activeSeconds: z.number().int().min(0).max(MAX_ACTIVE),
  pageSeconds: pageSecondsSchema,
  // optional, data room only: which document the pages belong to
  docs: z
    .array(
      z.object({
        bucketId: z.string().min(1).max(64),
        n: z.number().int().min(1).max(5000),
        p: pageSecondsSchema,
      }),
    )
    .max(MAX_DOCS)
    .optional(),
});

export const POST = async (req: Request) => {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  const { kind, token, visitId, activeSeconds, pageSeconds, docs } = body.data;

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
      docSeconds: true,
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

  // untrusted: keep only documents of this visit's data room
  let docSeconds: DocSeconds | undefined;
  if (kind === "DATA_ROOM" && docs?.length) {
    const ids = docs.map((d) => d.bucketId);
    const own = await db.dataRoomDocument.findMany({
      where: {
        dataRoomId: found.targetId,
        dataRoom: { companyId: found.companyId },
        document: { bucketId: { in: ids } },
      },
      select: { document: { select: { bucketId: true } } },
    });
    const allowed = new Set(own.map((d) => d.document.bucketId));
    const incoming: DocSeconds = {};
    for (const d of docs) {
      if (allowed.has(d.bucketId)) incoming[d.bucketId] = { n: d.n, p: d.p };
    }
    if (Object.keys(incoming).length) {
      docSeconds = mergeDocSeconds(
        (row.docSeconds ?? {}) as DocSeconds,
        incoming,
        ceiling,
      );
    }
  }

  await db.viewEvent.update({
    where: { id: row.id },
    data: {
      activeSeconds: Math.max(
        row.activeSeconds,
        Math.min(activeSeconds, ceiling),
      ),
      pageSeconds: merged,
      ...(docSeconds && { docSeconds }),
    },
  });
  return new Response(null, { status: 204 });
};
