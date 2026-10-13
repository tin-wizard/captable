import { logger } from "@/lib/logger";
import {
  MAX_AUTO_NUDGES,
  inWorkHours,
  nextStepWaitDays,
} from "@/server/activity/cadence";
import { sendReminder } from "@/server/activity/send-reminder";
import { findUnopened } from "@/server/activity/unopened";
import { db } from "@/server/db";
import { z } from "zod";
import { defineJob, defineWorker, defineWorkerConfig } from "../lib/queue";

const config = defineWorkerConfig({
  name: "email.auto-nudge",
  schema: z.object({}),
});
export const autoNudgeEmailJob = defineJob(config);

const DAY = 86_400_000;

// injectable so tests can pin the clock and lower the cap
export const clock = { now: () => new Date() };
export const limits = { perRun: 200 };

async function nudgeCompany(company: { id: string; name: string }, now: Date) {
  const companyId = company.id;
  const [rooms, updates] = await Promise.all([
    db.dataRoom.findMany({
      where: { companyId, autoNudge: true },
      select: { id: true },
    }),
    db.update.findMany({
      where: { companyId, autoNudge: true, status: "PUBLIC", public: true },
      select: { id: true },
    }),
  ]);
  const targets = [
    ...rooms.map((r) => ({ kind: "DATA_ROOM" as const, targetId: r.id })),
    ...updates.map((u) => ({ kind: "UPDATE" as const, targetId: u.id })),
  ];

  let sent = 0;
  for (const { kind, targetId } of targets) {
    const candidates = (
      await findUnopened(db, companyId, { kind, targetId, now })
    ).filter((u) => {
      const wait = nextStepWaitDays(u.nudgeCount);
      return (
        u.nudgeable &&
        !u.nudgeOptOut &&
        u.nudgeCount < MAX_AUTO_NUDGES &&
        wait !== null &&
        u.waitingSince.getTime() <= now.getTime() - wait * DAY
      );
    });
    for (const u of candidates) {
      if (sent >= limits.perRun) return sent;
      // the claim inside sendReminder re-checks the wait, the cooldown and
      // the cap, so an overlapping run or a manual click cannot double send
      const result = await sendReminder(db, {
        companyId,
        kind,
        targetId,
        recipientId: u.recipientId,
        sender: { name: company.name, email: null },
        actor: { type: "company", id: companyId },
        auto: { minWaitDays: nextStepWaitDays(u.nudgeCount) as number },
      });
      if (result.sent) sent++;
    }
  }
  return sent;
}

// Runs every hour. Companies with autoNudge on get reminders sent, in their
// local working hours, to recipients of rooms/updates that have it on too.
export const autoNudgeEmailWorker = defineWorker(config, async () => {
  const now = clock.now();
  const companies = await db.company.findMany({
    where: { autoNudge: true },
    select: { id: true, name: true, timezone: true },
  });
  for (const c of companies) {
    if (!inWorkHours(now, c.timezone)) continue;
    try {
      const sent = await nudgeCompany(c, now);
      if (sent)
        logger
          .child({ module: "queue" })
          .info(`auto-nudge sent ${sent} reminders for company ${c.id}`);
    } catch (error) {
      // one company's failure must not stop the others
      logger
        .child({ module: "queue" })
        .error(`auto-nudge failed for company ${c.id}`, { error });
    }
  }
});
