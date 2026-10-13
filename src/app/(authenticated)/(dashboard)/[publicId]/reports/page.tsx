import { analyticsParams, esignParams } from "@/components/analytics";
import { EsignAnalytics } from "@/components/analytics/esign/esign-analytics";
import { EngagementReport } from "@/components/analytics/reports/engagement-report";
import { OwnershipReport } from "@/components/analytics/reports/ownership-report";
import EmptyState from "@/components/common/empty-state";
import { PageLayout } from "@/components/dashboard/page-layout";
import { UnAuthorizedState } from "@/components/ui/un-authorized-state";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/server";
import { RiBarChartBoxFill } from "@remixicon/react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Reports",
};

const TABS = [
  { key: "engagement", label: "Engagement" },
  { key: "esign", label: "E-sign" },
  { key: "ownership", label: "Ownership" },
] as const;

const ReportsPage = async (props: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { publicId } = await props.params;
  const sp = await props.searchParams;
  const base = analyticsParams(sp);

  const overview = await api.analytics.company.query({
    range: base.range,
    from: base.from,
    to: base.to,
  });

  const available = TABS.filter((t) =>
    t.key === "engagement"
      ? overview.engagement
      : t.key === "esign"
        ? overview.esign
        : overview.holdings,
  );
  if (available.length === 0) return <UnAuthorizedState />;

  const requested = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = available.find((t) => t.key === requested) ?? available[0];

  const esign =
    tab?.key === "esign"
      ? await api.analytics.esign.query(esignParams(sp))
      : null;

  return (
    <PageLayout
      title="Reports"
      description="How your documents are read, signed and owned"
    >
      <nav aria-label="Report sections" className="mt-3 flex gap-1 border-b">
        {available.map((t) => (
          <Link
            key={t.key}
            href={`/${publicId}/reports?tab=${t.key}`}
            aria-current={t.key === tab?.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              t.key === tab?.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab?.key === "engagement" && overview.engagement && (
          <EngagementReport
            data={overview.engagement}
            companyPublicId={publicId}
          />
        )}
        {tab?.key === "esign" && esign && (
          <EsignAnalytics
            data={esign}
            filters={esignParams(sp)}
            companyPublicId={publicId}
          />
        )}
        {tab?.key === "ownership" && overview.holdings && (
          <OwnershipReport holdings={overview.holdings} />
        )}
        {!tab && (
          <EmptyState
            icon={<RiBarChartBoxFill />}
            title="No reports available."
            subtitle="Share a document or issue shares to see reports."
          />
        )}
      </div>
    </PageLayout>
  );
};

export default ReportsPage;
