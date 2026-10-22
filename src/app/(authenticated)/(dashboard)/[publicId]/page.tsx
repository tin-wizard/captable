import { dayjsExt } from "@/common/dayjs";
import {
  StatCard,
  formatCompact,
  formatCount,
  formatMoney,
} from "@/components/analytics";
import ActivitiesCard from "@/components/dashboard/overview/activities-card";
import { OwnershipCard } from "@/components/dashboard/overview/ownership-card";
import { SummaryTable } from "@/components/dashboard/overview/summary-table";
import { delta } from "@/server/analytics/range";
import { api } from "@/trpc/server";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Overview",
};

const OverviewPage = async (props: {
  params: Promise<{ publicId: string }>;
}) => {
  const params = await props.params;
  const { publicId } = params;

  const { holdings, stakeholders, engagement, esign } =
    await api.overview.summary.query();
  const base = `/${publicId}`;

  return (
    <>
      <header>
        <h3 className="text-[28px] font-semibold leading-tight tracking-[-0.015em]">
          Overview
        </h3>
        <p className="text-sm text-muted-foreground">
          Ownership, activity and what needs your attention
        </p>
      </header>

      {holdings && (
        <section
          aria-label="Key numbers"
          // styles StatCard internals (value div.truncate, label row .gap-1); update if StatCard markup changes
          className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded border bg-border lg:grid-cols-4 [&>*>*]:rounded-none [&>*>*]:border-0 sm:[&_div.truncate]:text-2xl [&_div.gap-1]:text-sm"
        >
          <StatCard
            label="Issued shares"
            value={formatCount(holdings.issuedShares)}
            hint="Shares with status Active."
          />
          <StatCard
            label="Fully diluted"
            value={formatCount(holdings.fullyDiluted)}
            hint="Issued shares + active options + the part of each equity plan reserve not yet granted."
          />
          <StatCard
            label="Issued value"
            value={formatMoney(holdings.issuedValue)}
            hint="Sum of each active share's capital contribution, or quantity × price per share when no contribution is recorded."
          />
          <StatCard
            label="Investments recorded"
            value={formatMoney(holdings.investmentsRecorded)}
            hint={`Sum of recorded investments.${
              holdings.convertibleCapital
                ? ` Plus ${formatMoney(
                    holdings.convertibleCapital,
                  )} in active SAFEs and notes, not yet converted.`
                : ""
            }`}
          />
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          {holdings && (
            <OwnershipCard
              byClass={holdings.byClass}
              byStakeholder={holdings.byStakeholder}
            />
          )}

          {engagement && (
            <section
              aria-label="This week"
              // styles StatCard internals (value div.truncate, label row .gap-1); update if StatCard markup changes
              className="grid grid-cols-1 divide-y overflow-hidden rounded border sm:auto-cols-fr sm:grid-flow-col sm:divide-x sm:divide-y-0 [&>*>*]:rounded-none [&>*>*]:border-0 sm:[&_div.truncate]:text-2xl [&_div.gap-1]:text-sm"
            >
              <StatCard
                label="Views this week"
                value={formatCompact(engagement.views7d)}
                delta={delta(engagement.views7d, engagement.viewsPrev7d)}
                spark={engagement.series.map((s) => ({
                  index: s.day,
                  value: s.views,
                }))}
                href={`${base}/activity`}
              />
              <StatCard
                label="Not opened yet"
                value={formatCount(engagement.unopened)}
                hint="Recipients who were sent a link at least 3 days ago and have not opened it."
                upIsGood={false}
                href={`${base}/documents/data-rooms`}
              />
              {esign && (
                <StatCard
                  label="Awaiting signatures"
                  value={formatCount(esign.pending)}
                  hint={`${esign.completed30d} completed in the last 30 days.`}
                  upIsGood={false}
                  href={`${base}/documents/esign`}
                />
              )}
            </section>
          )}
        </div>

        <div className="lg:col-span-4">
          {stakeholders !== null && (
            <p className="mb-4 text-sm text-muted-foreground">
              <Link
                href={`${base}/stakeholders`}
                className="text-primary underline underline-offset-2"
              >
                {formatCount(stakeholders)} stakeholder
                {stakeholders === 1 ? "" : "s"}
              </Link>
              {" · "}as of {dayjsExt().format("MMM D")}
            </p>
          )}
          <ActivitiesCard
            publicId={publicId}
            className="rounded border bg-card"
          />
        </div>
      </div>

      {holdings && (
        <div className="mt-10">
          <h4 className="font-medium">Summary</h4>
          <p className="text-sm text-muted-foreground">
            Issued shares and value by share class
          </p>
          <SummaryTable rows={holdings.byClass} />
        </div>
      )}
    </>
  );
};

export default OverviewPage;
