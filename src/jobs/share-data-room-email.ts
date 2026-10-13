import ShareDataRoomEmail from "@/emails/ShareDataRoomEmail";
import { sendMail } from "@/server/mailer";
import { render } from "@react-email/components";
import { z } from "zod";
import { defineJob, defineWorker, defineWorkerConfig } from "../lib/queue";

const config = defineWorkerConfig({
  name: "email.share-data-room",
  schema: z.object({
    link: z.string(),
    dataRoom: z.string(),
    email: z.string().email(),
    senderName: z.string(),
    companyName: z.string(),
    recipientName: z.string().nullish(),
    senderEmail: z.string().email().nullish(),
    reminder: z.boolean().optional(),
    unsubscribeLink: z.string().url().optional(),
  }),
});

export const shareDataRoomEmailJob = defineJob(config);

export const shareDataRoomEmailWorker = defineWorker(config, async (job) => {
  const {
    dataRoom,
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
    subject: `${
      reminder ? "Reminder: " : ""
    }${senderName} shared a data room - ${dataRoom}`,
    html: await render(
      ShareDataRoomEmail({
        senderName: senderName,
        recipientName,
        companyName,
        dataRoom,
        link,
        unsubscribeLink: reminder ? unsubscribeLink : undefined,
      }),
    ),

    headers: {
      "X-From-Name": senderName,
    },
  });
});
