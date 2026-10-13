import { db } from "@/server/db";
import { z } from "zod";
import { defineJob, defineWorker, defineWorkerConfig } from "../lib/queue";

// Used when a company has not chosen a period (the column default as well).
export const DEFAULT_RETENTION_MONTHS = 24;

const config = defineWorkerConfig({
  name: "maintenance.purge-view-events",
  schema: z.object({}),
});

export const purgeViewEventsJob = defineJob(config);

export function retentionCutoff(
  now = new Date(),
  months = DEFAULT_RETENTION_MONTHS,
) {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

// Global db on purpose: retention is a platform job, but each company is
// purged at its own period and companyId is explicit in every delete.
// viewRetentionMonths = null means the company keeps its data.
export const purgeViewEventsWorker = defineWorker(config, async () => {
  const companies = await db.company.findMany({
    where: { viewRetentionMonths: { not: null } },
    select: { id: true, viewRetentionMonths: true },
  });
  const now = new Date();
  for (const c of companies) {
    await db.viewEvent.deleteMany({
      where: {
        companyId: c.id,
        createdAt: {
          lt: retentionCutoff(
            now,
            c.viewRetentionMonths ?? DEFAULT_RETENTION_MONTHS,
          ),
        },
      },
    });
  }
});
