import ShareUpdateEmail from "@/emails/ShareUpdateEmail";
import { sendMail } from "@/server/mailer";
import { render } from "@react-email/components";
import { z } from "zod";
import { defineJob, defineWorker, defineWorkerConfig } from "../lib/queue";

const config = defineWorkerConfig({
  name: "email.share-update",
  schema: z.object({
    update: z.object({
      title: z.string(),
    }),
    link: z.string(),
    companyName: z.string(),
    senderName: z.string(),
    email: z.string().email(),
    recipientName: z.string().nullish(),
    senderEmail: z.string().email().nullish(),
    reminder: z.boolean().optional(),
    unsubscribeLink: z.string().url().optional(),
  }),
});

export const shareUpdateEmailJob = defineJob(config);

export const shareUpdateEmailWorker = defineWorker(config, async (job) => {
  const {
    update,
    link,
    companyName,
    recipientName,
    senderName,
    email,
    senderEmail,
    reminder,
    unsubscribeLink,
  } = job.data;
  await sendMail({
    to: email,
    ...(senderEmail && { replyTo: senderEmail }),
    subject: `${reminder ? "Reminder: " : ""}${senderName} shared an update - ${
      update.title
    }`,
    html: await render(
      ShareUpdateEmail({
        senderName: senderName,
        recipientName,
        companyName,
        updateTitle: update.title,
        link,
        unsubscribeLink: reminder ? unsubscribeLink : undefined,
      }),
    ),

    headers: {
      "X-From-Name": senderName,
    },
  });
});
