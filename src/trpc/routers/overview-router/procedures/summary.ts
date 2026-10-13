import { findUnopened } from "@/server/activity/unopened";
import { getHoldings } from "@/server/analytics/holdings";
import { canRead } from "@/server/analytics/permissions";
import { dayBuckets, localDay } from "@/server/analytics/range";
import { withAccessControl } from "@/trpc/api/trpc";

const DAY = 86_400_000;

// Overview numbers. Each block is null when the caller's role cannot read it,
// so a member with audits:read only never receives holdings and vice versa.
export const summaryProcedure = withAccessControl.query(async ({ ctx }) => {
  const { db, companyId } = ctx.tenant;
  const now = new Date();
  const perms = ctx.permissions;

  const holdings = canRead(perms, "securities") ? await getHoldings(db) : null;

  const stakeholders = canRead(perms, "stakeholders")
    ? await db.stakeholder.count()
    : null;

  let engagement = null;
  if (canRead(perms, "audits")) {
    const since = new Date(now.getTime() - 14 * DAY);
    const events = await db.viewEvent.findMany({
      where: { createdAt: { gte: since }, isBot: false },
      select: { createdAt: true },
      take: 50_000,
    });
    const cut = now.getTime() - 7 * DAY;
    const views7d = events.filter((e) => e.createdAt.getTime() >= cut).length;
    const { timezone: tz } = await db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true },
    });
    // the last 7 local calendar days; a 7*24h span can touch 8 across DST
    const days = dayBuckets(new Date(now.getTime() - 7 * DAY), now, tz).slice(
      -7,
    );
    const perDay = new Map(days.map((d) => [d, 0]));
    for (const e of events) {
      const k = localDay(e.createdAt, tz);
      if (perDay.has(k)) perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    engagement = {
      views7d,
      viewsPrev7d: events.length - views7d,
      unopened: (await findUnopened(db, companyId)).length,
      series: days.map((day) => ({ day, views: perDay.get(day) ?? 0 })),
    };
  }

  let esign = null;
  if (canRead(perms, "templates")) {
    const [pending, completed30d] = await Promise.all([
      db.template.count({ where: { status: "PENDING" } }),
      db.template.count({
        where: {
          status: "COMPLETE",
          completedOn: { gte: new Date(now.getTime() - 30 * DAY) },
        },
      }),
    ]);
    esign = { pending, completed30d };
  }

  return { holdings, stakeholders, engagement, esign };
});
