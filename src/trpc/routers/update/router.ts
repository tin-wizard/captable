import { createTRPCRouter } from "@/trpc/api/trpc";
import {
  setAutoNudgeProcedure,
  stopUpdateRemindersProcedure,
} from "./procedures/auto-nudge";
import { cloneUpdateProcedure } from "./procedures/clone-update";
import {
  getRecipientsProcedure,
  getUpdatesProcedure,
} from "./procedures/get-updates";
import { nudgeUpdateProcedure } from "./procedures/nudge-update";
import { saveUpdateProcedure } from "./procedures/save-update";
import {
  shareUpdateProcedure,
  unshareUpdateProcedure,
} from "./procedures/share-update";
import { toggleUpdateVisibilityProcedure } from "./procedures/toggle-update-visibility";

export const updateRouter = createTRPCRouter({
  save: saveUpdateProcedure,
  get: getUpdatesProcedure,
  getRecipients: getRecipientsProcedure,
  clone: cloneUpdateProcedure,
  share: shareUpdateProcedure,
  unShare: unshareUpdateProcedure,
  nudge: nudgeUpdateProcedure,
  setAutoNudge: setAutoNudgeProcedure,
  stopReminders: stopUpdateRemindersProcedure,
  toggleVisibility: toggleUpdateVisibilityProcedure,
});
