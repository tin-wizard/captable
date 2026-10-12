import { decode } from "@/lib/jwt";
import { db } from "@/server/db";
import { DecodeEmailToken } from "@/trpc/routers/template-field-router/procedures/add-fields";
import type { ViewKind } from "@prisma/client";

export type Found = {
  companyId: string;
  targetId: string;
  recipientId: string;
  templateName?: string;
  recipientName?: string | null;
};

// Same tokens the public pages already accept; this only reads them.
// null for anything invalid, expired, or not owned by the company in the token.
export async function resolveRecipient(
  kind: ViewKind,
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
      select: { id: true, status: true, public: true },
    });
    // a revoked or draft update is not viewable, so it records nothing
    if (!update || update.status !== "PUBLIC" || !update.public) return null;
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
