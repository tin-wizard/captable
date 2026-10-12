import ViewAlertEmail from "@/emails/ViewAlertEmail";
import { env } from "@/env";
import { describeTarget } from "@/server/activity/describe";
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

export const viewAlertEmailWorker = defineWorker(config, async (job) => {
  const d = job.data;
  const [company, target] = await Promise.all([
    db.company.findUniqueOrThrow({
      where: { id: d.companyId },
      select: { name: true, publicId: true },
    }),
    describeTarget(d),
  ]);

  const members = await db.member.findMany({
    where: {
      companyId: d.companyId,
      status: "ACTIVE",
      notifyOnView: true,
      viewDigest: false,
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
