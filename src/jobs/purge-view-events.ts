import { db } from "@/server/db";
import { z } from "zod";
import { defineJob, defineWorker, defineWorkerConfig } from "../lib/queue";

export const RETENTION_MONTHS = 24;

const config = defineWorkerConfig({
  name: "maintenance.purge-view-events",
  schema: z.object({}),
});

export const purgeViewEventsJob = defineJob(config);

export function retentionCutoff(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
  return cutoff;
}

// Global db on purpose: retention is a platform rule, not a per-tenant action.
export const purgeViewEventsWorker = defineWorker(config, async () => {
  await db.viewEvent.deleteMany({
    where: { createdAt: { lt: retentionCutoff() } },
  });
});
