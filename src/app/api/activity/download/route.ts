import { getIp, getUserAgent } from "@/lib/headers";
import { getNdaState } from "@/server/activity/nda";
import { resolveRecipient } from "@/server/activity/resolve-recipient";
import { db } from "@/server/db";
import { getPresignedGetUrl } from "@/server/file-uploads";
import { truncateIp } from "@/server/view-events";
import { z } from "zod";

const bodySchema = z.object({
  kind: z.literal("DATA_ROOM").default("DATA_ROOM"),
  token: z.string().min(1).max(4096),
  bucketId: z.string().min(1).max(64),
});

// Public, token-authenticated (the recipient's own link token). Records and
// controls our Download button only; it is not copy protection. Every refusal
// happens before anything is recorded or any URL is minted.
export const POST = async (req: Request) => {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });

  const { kind, token, bucketId } = body.data;
  const found = await resolveRecipient(kind, token);
  if (!found) return new Response(null, { status: 404 });

  const room = await db.dataRoom.findFirst({
    where: { id: found.targetId, companyId: found.companyId },
    select: {
      allowDownload: true,
      documents: {
        where: { document: { bucketId } },
        select: {
          document: {
            select: { bucket: { select: { key: true, name: true } } },
          },
        },
        take: 1,
      },
    },
  });
  const bucket = room?.documents[0]?.document.bucket;
  if (!room || !bucket) return new Response(null, { status: 404 });
  if (!room.allowDownload) return new Response(null, { status: 403 });

  const target = {
    kind,
    targetId: found.targetId,
    recipientId: found.recipientId,
    companyId: found.companyId,
  };
  const nda = await getNdaState(db, target);
  if (nda.required && !nda.accepted) return new Response(null, { status: 403 });

  await db.downloadEvent.create({
    data: {
      ...target,
      bucketId,
      ip: truncateIp(getIp(req.headers)),
      userAgent: getUserAgent(req.headers).slice(0, 512),
    },
  });
  const { url } = await getPresignedGetUrl(bucket.key, {
    attachmentName: bucket.name,
  });
  return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
};
