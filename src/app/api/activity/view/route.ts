import { viewAlertEmailJob } from "@/jobs/view-alert-email";
import { getIp, getUserAgent } from "@/lib/headers";
import { resolveRecipient } from "@/server/activity/resolve-recipient";
import { EsignAudit } from "@/server/audit";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { lookupGeo } from "@/server/geo";
import { recordView } from "@/server/view-events";
import { z } from "zod";

const bodySchema = z.object({
  kind: z.enum(["DATA_ROOM", "UPDATE", "ESIGN"]),
  token: z.string().min(1),
  timezone: z.string().max(64).optional(),
});

// the company's own active members previewing their link are not visits;
// any session or lookup failure counts as "not a member", so recording goes on
async function isOwnMember(companyId: string) {
  try {
    const session = await getServerAuthSession();
    if (!session?.user.id) return false;
    const member = await db.member.findFirst({
      where: { userId: session.user.id, companyId, status: "ACTIVE" },
      select: { id: true },
    });
    return !!member;
  } catch {
    return false;
  }
}

export const POST = async (req: Request) => {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });

  const { kind, token } = body.data;
  const found = await resolveRecipient(kind, token);
  if (!found) return new Response(null, { status: 404 });

  const ip = getIp(req.headers);
  const userAgent = getUserAgent(req.headers).slice(0, 512);

  // not for e-sign: every signer's view feeds the recipient.viewed audit row
  if (kind !== "ESIGN" && (await isOwnMember(found.companyId)))
    return Response.json({ visitId: null });

  // geo reads the full ip in memory; recordView stores only the truncated one
  const geo = await lookupGeo(ip);
  const { visit, id } = await recordView(db, {
    companyId: found.companyId,
    kind,
    targetId: found.targetId,
    recipientId: found.recipientId,
    ip,
    userAgent,
    timezone: body.data.timezone,
    ...geo,
  });

  // the e-sign trail keeps the full ip, like recipient.signed does
  if (kind === "ESIGN" && visit === "first") {
    await EsignAudit.create(
      {
        action: "recipient.viewed",
        companyId: found.companyId,
        templateId: found.targetId,
        recipientId: found.recipientId,
        ip,
        userAgent,
        location: "",
        summary: `${found.recipientName ?? "A recipient"} viewed "${
          found.templateName
        }"`,
      },
      db,
    );
  }

  if (visit === "first" || visit === "return") {
    await viewAlertEmailJob.emit(
      {
        companyId: found.companyId,
        kind,
        targetId: found.targetId,
        recipientId: found.recipientId,
        occurrence: visit,
      },
      {
        singletonKey: `${kind}:${found.recipientId}:${visit}`,
        singletonSeconds: 1800,
      },
    );
  }

  return Response.json({ visitId: visit === "bot" ? null : id });
};
