import { getIp, getUserAgent } from "@/lib/headers";
import { getNdaState } from "@/server/activity/nda";
import { resolveRecipient } from "@/server/activity/resolve-recipient";
import { db } from "@/server/db";
import { truncateIp } from "@/server/view-events";
import { Prisma } from "@prisma/client";
import { z } from "zod";

const bodySchema = z.object({
  kind: z.enum(["DATA_ROOM", "UPDATE"]),
  token: z.string().min(1).max(4096),
});

// Public, token-authenticated (the recipient's own link token). Company, target
// and recipient come from the token only; a dead link is a 404, nothing stored.
export const POST = async (req: Request) => {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });

  const { kind, token } = body.data;
  const found = await resolveRecipient(kind, token);
  if (!found) return new Response(null, { status: 404 });

  const target = {
    kind,
    targetId: found.targetId,
    recipientId: found.recipientId,
    companyId: found.companyId,
  };
  const state = await getNdaState(db, target);
  if (!state.required || state.accepted)
    return new Response(null, { status: 204 });

  try {
    await db.ndaAcceptance.create({
      data: {
        ...target,
        text: state.text,
        ip: truncateIp(getIp(req.headers)),
        userAgent: getUserAgent(req.headers).slice(0, 512),
      },
    });
  } catch (e) {
    // a concurrent accept won the unique (kind, targetId, recipientId): same outcome
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    )
      throw e;
  }
  return new Response(null, { status: 204 });
};
