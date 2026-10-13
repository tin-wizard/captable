import { canRead } from "@/server/analytics/permissions";
import { TRPCError } from "@trpc/server";

// audits:read is the procedure policy; the source's own read permission is
// checked here because it depends on the input kind.
export function assertSourceRead(
  perms: { subject: string; actions: string[] }[],
  kind: "DATA_ROOM" | "UPDATE",
) {
  const subject = kind === "DATA_ROOM" ? "data-rooms" : "updates";
  if (!canRead(perms, subject))
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You do not have access to this section.",
    });
}

type Finder = {
  dataRoom: { findFirst: (a: unknown) => Promise<{ id: string } | null> };
  update: { findFirst: (a: unknown) => Promise<{ id: string } | null> };
};

// the target must be one of the caller's company (tenant client scopes it)
export async function resolveTarget(
  db: Finder,
  kind: "DATA_ROOM" | "UPDATE",
  publicId: string,
) {
  const where = { publicId };
  const select = { id: true };
  const found =
    kind === "DATA_ROOM"
      ? await db.dataRoom.findFirst({ where, select })
      : await db.update.findFirst({ where, select });
  return found?.id ?? null;
}
