import { ViewEventKind } from "@/prisma/enums";
import { db } from "@/server/db";

// A page refresh or a prefetch should not look like a new visit.
export const VIEW_THROTTLE_MS = 10 * 60 * 1000;

export type RecordViewInput = {
  companyId: string;
  kind: ViewEventKind;
  recipientId: string;
  recipientEmail: string;
  dataRoomId?: string;
  bucketId?: string;
  updateId?: string;
};

/**
 * Records that a recipient opened a public share link. Never throws: a
 * failure to log must not stop an investor from reading the page.
 *
 * Called from the public link pages only, after the signed token and the
 * recipient have been verified, so recipientId/recipientEmail are trusted.
 */
export async function recordView(input: RecordViewInput) {
  try {
    const recent = await db.viewEvent.findFirst({
      where: {
        companyId: input.companyId,
        kind: input.kind,
        recipientId: input.recipientId,
        dataRoomId: input.dataRoomId ?? null,
        bucketId: input.bucketId ?? null,
        updateId: input.updateId ?? null,
        viewedAt: { gt: new Date(Date.now() - VIEW_THROTTLE_MS) },
      },
      select: { id: true },
    });
    if (recent) return;
    await db.viewEvent.create({ data: input });
  } catch (error) {
    console.error("recordView failed", error);
  }
}

export { ViewEventKind };
