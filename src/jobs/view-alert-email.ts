import ViewAlertEmail from "@/emails/ViewAlertEmail";
import { env } from "@/env";
import { db } from "@/server/db";
import { sendMail } from "@/server/mailer";
import { render } from "@react-email/components";
import { z } from "zod";
import { defineJob, defineWorker, defineWorkerConfig } from "../lib/queue";

const config = defineWorkerConfig({
  name: "email.view-alert",
  schema: z.object({
    companyId: z.string(),
    kind: z.enum(["DATA_ROOM", "UPDATE", "ESIGN"]),
    targetId: z.string(),
    recipientId: z.string(),
    occurrence: z.enum(["first", "return"]),
  }),
});

export const viewAlertEmailJob = defineJob(config);

type Described = {
  label: string;
  path: string;
  who: string;
  // the member who created the thing, notified besides the admins
  ownerMemberId: string | null;
};

type Data = z.infer<(typeof config)["schema"]>;

async function describe(d: Data): Promise<Described> {
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

export const viewAlertEmailWorker = defineWorker(config, async (job) => {
  const d = job.data;
  const [company, target] = await Promise.all([
    db.company.findUniqueOrThrow({
      where: { id: d.companyId },
      select: { name: true, publicId: true },
    }),
    describe(d),
  ]);

  const members = await db.member.findMany({
    where: {
      companyId: d.companyId,
      status: "ACTIVE",
      notifyOnView: true,
      OR: [
        { role: "ADMIN" },
        ...(target.ownerMemberId ? [{ id: target.ownerMemberId }] : []),
      ],
    },
    select: { user: { select: { email: true } } },
  });

  const link = `${env.NEXT_PUBLIC_BASE_URL}/${company.publicId}/${target.path}`;
  const verb = d.occurrence === "first" ? "opened" : "came back to";
  const html = await render(
    ViewAlertEmail({
      companyName: company.name,
      who: target.who,
      label: target.label,
      occurrence: d.occurrence,
      link,
    }),
  );

  // one mail per person so addresses are never shown to each other
  await Promise.all(
    members
      .map((m) => m.user.email)
      .filter((email): email is string => Boolean(email))
      .map((to) =>
        sendMail({
          to,
          subject: `${target.who} ${verb} ${target.label}`,
          html,
        }),
      ),
  );
});
