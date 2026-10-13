import type { TPrismaOrTransaction } from "@/server/db";

export const DEFAULT_NDA_TEXT =
  "[Your company] confidentiality notice. Replace this text in Settings → Company.";

export type NdaTarget = {
  kind: "DATA_ROOM" | "UPDATE";
  targetId: string;
  recipientId: string;
  companyId: string;
};

export type NdaState =
  | { required: false }
  | { required: true; accepted: boolean; text: string };

// Every read is scoped by companyId: a target of another company reads as "off".
export async function getNdaState(
  db: TPrismaOrTransaction,
  { kind, targetId, recipientId, companyId }: NdaTarget,
): Promise<NdaState> {
  const where = { id: targetId, companyId };
  const select = { requireNda: true, company: { select: { ndaText: true } } };
  const target =
    kind === "DATA_ROOM"
      ? await db.dataRoom.findFirst({ where, select })
      : await db.update.findFirst({ where, select });
  if (!target?.requireNda) return { required: false };

  const accepted = await db.ndaAcceptance.findFirst({
    where: { kind, targetId, recipientId, companyId },
    select: { id: true },
  });
  return {
    required: true,
    accepted: !!accepted,
    text: target.company.ndaText ?? DEFAULT_NDA_TEXT,
  };
}
