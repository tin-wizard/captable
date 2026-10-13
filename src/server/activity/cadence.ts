import { UNOPENED_AFTER_DAYS } from "@/server/activity/unopened";
import { localHour } from "@/server/analytics/range";

// automatic reminders per recipient, ever; a manual one counts too
export const MAX_AUTO_NUDGES = 2;
export const SECOND_NUDGE_AFTER_DAYS = 4;
export const WORK_HOURS = { from: 9, to: 18 }; // local, [from, to)

export function inWorkHours(now: Date, tz: string): boolean {
  const h = localHour(now, tz);
  return h >= WORK_HOURS.from && h < WORK_HOURS.to;
}

// minimum days the recipient must have waited (since updatedAt, which a
// reminder bumps) before the next automatic reminder, or null when none is due
export function nextStepWaitDays(nudgeCount: number): number | null {
  if (nudgeCount <= 0) return UNOPENED_AFTER_DAYS;
  if (nudgeCount < MAX_AUTO_NUDGES) return SECOND_NUDGE_AFTER_DAYS;
  return null;
}
