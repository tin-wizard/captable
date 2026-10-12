import { viewAlertEmailJob } from "@/jobs/view-alert-email";
import { getIp, getUserAgent } from "@/lib/headers";
import { decode } from "@/lib/jwt";
import { EsignAudit } from "@/server/audit";
import { db } from "@/server/db";
import { recordView } from "@/server/view-events";
import { DecodeEmailToken } from "@/trpc/routers/template-field-router/procedures/add-fields";
import { z } from "zod";

const bodySchema = z.object({
  kind: z.enum(["DATA_ROOM", "UPDATE", "ESIGN"]),
  token: z.string().min(1),
});

type Kind = z.infer<typeof bodySchema>["kind"];

type Found = {
  companyId: string;
  targetId: string;
  recipientId: string;
  templateName?: string;
  recipientName?: string | null;
};

// Same tokens the public pages already accept; this only reads them.
// null for anything invalid, expired, or not owned by the company in the token.
async function resolveRecipient(
  kind: Kind,
  token: string,
): Promise<Found | null> {
  try {
    if (kind === "ESIGN") {
      const { id: templateId, rec } = await DecodeEmailToken(token);
      const r = await db.esignRecipient.findFirst({
        where: { id: rec, templateId },
        select: {
          id: true,
          name: true,
          template: { select: { companyId: true, name: true } },
        },
      });
      return r
        ? {
            companyId: r.template.companyId,
            targetId: templateId,
            recipientId: r.id,
            templateName: r.template.name,
            recipientName: r.name,
          }
        : null;
    }

    const { payload } = await decode(token);
    const p = payload as Record<string, string | undefined>;
    if (!p.companyId || !p.recipientId) return null;

    if (kind === "DATA_ROOM") {
      if (!p.dataRoomId) return null;
      const r = await db.dataRoomRecipient.findFirst({
        where: {
          id: p.recipientId,
          dataRoomId: p.dataRoomId,
          dataRoom: { companyId: p.companyId },
        },
        select: { id: true },
      });
      return r
        ? { companyId: p.companyId, targetId: p.dataRoomId, recipientId: r.id }
        : null;
    }

    if (!p.publicId) return null;
    const update = await db.update.findFirst({
      where: { publicId: p.publicId, companyId: p.companyId },
      select: { id: true },
    });
    if (!update) return null;
    const r = await db.updateRecipient.findFirst({
      where: { id: p.recipientId, updateId: update.id },
      select: { id: true },
    });
    return r
      ? { companyId: p.companyId, targetId: update.id, recipientId: r.id }
      : null;
  } catch {
    return null;
  }
}

export const POST = async (req: Request) => {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });

  const { kind, token } = body.data;
  const found = await resolveRecipient(kind, token);
  if (!found) return new Response(null, { status: 404 });

  const ip = getIp(req.headers);
  const userAgent = getUserAgent(req.headers);

  const visit = await recordView(db, {
    companyId: found.companyId,
    kind,
    targetId: found.targetId,
    recipientId: found.recipientId,
    ip,
    userAgent,
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

  return new Response(null, { status: 204 });
};
