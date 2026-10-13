import { logger } from "@/lib/logger";
import { queue, queueManager } from "../lib/queue";
import { authVerificationEmailWorker } from "./auth-verification-email";
import { eSignCompletePDFWorker } from "./esign-complete-pdf";
import { eSignConfirmationEmailWorker } from "./esign-confirmation-email";
import { eSignNotificationEmailWorker } from "./esign-email";
import { eSignPdfWorker } from "./esign-pdf";
import { sendMemberInviteEmailWorker } from "./member-inivite-email";
import { passwordResetEmailWorker } from "./password-reset-email";
import { purgeViewEventsWorker } from "./purge-view-events";
import { shareDataRoomEmailWorker } from "./share-data-room-email";
import { shareUpdateEmailWorker } from "./share-update-email";
import { viewAlertEmailWorker } from "./view-alert-email";
import { viewDigestEmailWorker } from "./view-digest-email";

export async function registerJobs() {
  queueManager.register(shareDataRoomEmailWorker);
  queueManager.register(shareUpdateEmailWorker);
  queueManager.register(viewAlertEmailWorker);
  queueManager.register(viewDigestEmailWorker);
  queueManager.register(passwordResetEmailWorker);
  queueManager.register(sendMemberInviteEmailWorker);
  queueManager.register(eSignNotificationEmailWorker);
  queueManager.register(authVerificationEmailWorker);
  queueManager.register(eSignConfirmationEmailWorker);
  queueManager.register(eSignPdfWorker);
  queueManager.register(eSignCompletePDFWorker);

  queueManager.register(purgeViewEventsWorker);

  //start
  await queueManager.start();

  // upserted by name (pg-boss), so repeated app starts are idempotent; a
  // failure here must never stop the app from booting
  await queue
    .schedule("maintenance.purge-view-events", "17 3 * * *", {})
    .catch(() =>
      logger
        .child({ module: "queue" })
        .warn("could not schedule maintenance.purge-view-events"),
    );

  // a restart during the 07:00 UTC run makes pg-boss retry the whole job: members can get a duplicate; avoid deploying then
  await queue
    .schedule("email.view-digest", "0 * * * *", {})
    .catch(() =>
      logger
        .child({ module: "queue" })
        .warn("could not schedule email.view-digest"),
    );
}
