import { db } from "@/server/db";

export type Described = {
  label: string;
  path: string;
  who: string;
  // the member who created the thing, notified besides the admins
  ownerMemberId: string | null;
};

export async function describeTarget(d: {
  companyId: string;
  kind: "DATA_ROOM" | "UPDATE" | "ESIGN";
  targetId: string;
  recipientId: string;
}): Promise<Described> {
  if (d.kind === "DATA_ROOM") {
    const [room, rec] = await Promise.all([
      db.dataRoom.findFirstOrThrow({
        where: { id: d.targetId, companyId: d.companyId },
        select: { name: true, publicId: true, createdById: true },
      }),
      db.dataRoomRecipient.findUniqueOrThrow({
        where: { id: d.recipientId },
        select: { name: true, email: true },
      }),
    ]);
    return {
      label: `the data room "${room.name}"`,
      path: `documents/data-rooms/${room.publicId}`,
      who: rec.name || rec.email,
      ownerMemberId: room.createdById,
    };
  }
  if (d.kind === "UPDATE") {
    const [update, rec] = await Promise.all([
      db.update.findFirstOrThrow({
        where: { id: d.targetId, companyId: d.companyId },
        select: { title: true, publicId: true, authorId: true },
      }),
      db.updateRecipient.findUniqueOrThrow({
        where: { id: d.recipientId },
        select: { name: true, email: true },
      }),
    ]);
    return {
      label: `the update "${update.title}"`,
      path: `updates/${update.publicId}`,
      who: rec.name || rec.email,
      ownerMemberId: update.authorId,
    };
  }
  const [template, rec] = await Promise.all([
    db.template.findFirstOrThrow({
      where: { id: d.targetId, companyId: d.companyId },
      select: { name: true, publicId: true, uploaderId: true },
    }),
    db.esignRecipient.findUniqueOrThrow({
      where: { id: d.recipientId },
      select: { name: true, email: true },
    }),
  ]);
  return {
    label: `the document "${template.name}"`,
    path: `documents/esign/v/${template.publicId}`,
    who: rec.name || rec.email,
    ownerMemberId: template.uploaderId,
  };
}
