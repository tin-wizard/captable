import { resolveRecipient } from "@/server/activity/resolve-recipient";
import { db } from "@/server/db";

// Stops automatic reminders for the one recipient the link names. Returns
// false for anything the link cannot prove (unknown, expired, revoked): the
// caller answers all of those the same way. The row's updatedAt is kept so an
// opt-out does not restart that recipient's waiting clock.
export async function unsubscribeRecipient(
  kind: "DATA_ROOM" | "UPDATE",
  token: string,
): Promise<boolean> {
  const found = await resolveRecipient(kind, token);
  if (!found) return false;

  if (kind === "DATA_ROOM") {
    const rec = await db.dataRoomRecipient.findFirst({
      where: {
        id: found.recipientId,
        dataRoomId: found.targetId,
        dataRoom: { companyId: found.companyId },
      },
      select: { updatedAt: true },
    });
    if (!rec) return false;
    await db.dataRoomRecipient.updateMany({
      where: {
        id: found.recipientId,
        dataRoom: { companyId: found.companyId },
      },
      data: { nudgeOptOut: true, updatedAt: rec.updatedAt },
    });
    return true;
  }

  const rec = await db.updateRecipient.findFirst({
    where: {
      id: found.recipientId,
      updateId: found.targetId,
      update: { companyId: found.companyId },
    },
    select: { updatedAt: true },
  });
  if (!rec) return false;
  await db.updateRecipient.updateMany({
    where: { id: found.recipientId, update: { companyId: found.companyId } },
    data: { nudgeOptOut: true, updatedAt: rec.updatedAt },
  });
  return true;
}
