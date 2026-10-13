"use client";

import { TemplateCancelButton } from "@/app/(authenticated)/(dashboard)/[publicId]/documents/esign/components/temp-cancel-btx";
import { dayjsExt } from "@/common/dayjs";
import {
  ChartCard,
  CsvButton,
  FilterChips,
  Pager,
  RangeTabs,
  SearchBox,
  StatCard,
  chartColors,
  formatHours,
  formatPercent,
} from "@/components/analytics";
import FileIcon from "@/components/common/file-icon";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toCsv } from "@/server/analytics/csv";
import type { EsignAnalytics as Data } from "@/server/analytics/esign";
import { delta } from "@/server/analytics/range";
import { api } from "@/trpc/react";
import { AreaChart, BarChart, DonutChart } from "@tremor/react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Filters = {
  range?: "7d" | "30d" | "90d" | "custom";
  from?: string;
  to?: string;
  status?: ("DRAFT" | "PENDING" | "COMPLETE" | "CANCELLED")[];
  stuck?: boolean;
  signer?: string;
  search?: string;
  cursor?: string;
};

const STATUS_VARIANT = {
  DRAFT: "info",
  PENDING: "secondary",
  COMPLETE: "success",
  CANCELLED: "destructive",
} as const;

export const EsignAnalytics = ({
  data,
  filters,
  companyPublicId,
}: {
  data: Data;
  filters: Filters;
  companyPublicId: string;
}) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const utils = api.useContext();
  const { kpis, funnel } = data;
  const noData = kpis.sent === 0 && data.envelopes.items.length === 0;

  const stages = [
    { Stage: "Sent", Signers: funnel.sent },
    ...(funnel.viewed !== null
      ? [{ Stage: "Opened", Signers: funnel.viewed }]
      : []),
    { Stage: "Signed", Signers: funnel.signed },
  ];
  const lost = (i: number) => {
    const a = stages[i - 1]?.Signers ?? 0;
    const b = stages[i]?.Signers ?? 0;
    return a ? Math.round(((a - b) / a) * 100) : 0;
  };

  const exportCsv = async () => {
    const rows: Data["envelopes"]["items"] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const res = await utils.analytics.esign.fetch({
        ...filters,
        cursor,
        limit: 50,
      });
      rows.push(...res.envelopes.items);
      if (!res.envelopes.nextCursor) break;
      cursor = res.envelopes.nextCursor;
    }
    const csv = toCsv(
      rows.map((r) => ({
        name: r.name,
        status: r.status,
        created: r.createdAt,
        sent: r.sentAt,
        completed: r.completedAt,
        signed: r.signers.signed,
        signers: r.signers.total,
        hours_to_complete: r.hoursToComplete,
        waiting_on: r.waitingOn.map((w) => w.email).join(" "),
        stuck: r.stuck ? "yes" : "no",
      })),
      [
        { key: "name", label: "Document" },
        { key: "status", label: "Status" },
        { key: "created", label: "Created" },
        { key: "sent", label: "Sent" },
        { key: "completed", label: "Completed" },
        { key: "signed", label: "Signed" },
        { key: "signers", label: "Signers" },
        { key: "hours_to_complete", label: "Hours to complete" },
        { key: "waiting_on", label: "Waiting on" },
        { key: "stuck", label: "Stuck" },
      ],
    );
    return {
      filename: `esign-${data.range.from.slice(0, 10)}-${data.range.to.slice(
        0,
        10,
      )}.csv`,
      csv,
    };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangeTabs />
      </div>

      <section
        aria-label="Key numbers"
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        <StatCard
          label="Sent"
          value={String(kpis.sent)}
          delta={delta(kpis.sent, kpis.previous.sent)}
          spark={data.series.map((s) => ({ index: s.day, value: s.sent }))}
        />
        <StatCard
          label="Completed"
          value={`${kpis.completed}`}
          hint={`Completion rate ${formatPercent(kpis.completionRate)}`}
          delta={delta(kpis.completed, kpis.previous.completed)}
          spark={data.series.map((s) => ({ index: s.day, value: s.completed }))}
        />
        <StatCard
          label="Median time to sign"
          value={formatHours(kpis.medianHoursToSign)}
          hint={`Average ${formatHours(
            kpis.avgHoursToSign,
          )}. Time from the signing email to the signature.`}
          upIsGood={false}
          delta={
            kpis.medianHoursToSign !== null &&
            kpis.previous.medianHoursToSign !== null
              ? delta(kpis.medianHoursToSign, kpis.previous.medianHoursToSign)
              : undefined
          }
        />
        <StatCard
          label="Waiting on signers"
          value={String(kpis.pendingSigners)}
          hint={`${kpis.stuckSigners} waiting 3 days or more.`}
          upIsGood={false}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Sent and completed"
          description="Envelopes per day"
          state={noData ? "empty" : "ready"}
          emptyHint="Send a document for signature to see activity."
          tableAlt={{
            columns: ["Day", "Sent", "Completed"],
            rows: data.series.map((s) => [s.day, s.sent, s.completed]),
          }}
        >
          {mounted && (
            <AreaChart
              className="h-56"
              data={data.series.map((s) => ({
                Day: dayjsExt(s.day).format("MMM D"),
                Sent: s.sent,
                Completed: s.completed,
              }))}
              index="Day"
              categories={["Sent", "Completed"]}
              colors={[chartColors.primary, chartColors.success]}
              allowDecimals={false}
              yAxisWidth={32}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Status"
          state={noData ? "empty" : "ready"}
          emptyHint="No documents in this period."
          tableAlt={{
            columns: ["Status", "Documents"],
            rows: Object.entries(data.statusMix).map(([k, v]) => [k, v]),
          }}
        >
          <ul className="mb-2 space-y-1 text-sm">
            {Object.entries(data.statusMix).map(([k, v]) => (
              <li key={k} className="flex justify-between">
                <span>{k[0] + k.slice(1).toLowerCase()}</span>
                <span className="font-medium">{v}</span>
              </li>
            ))}
          </ul>
          {mounted && (
            <DonutChart
              className="h-32"
              data={Object.entries(data.statusMix).map(([name, value]) => ({
                name,
                value,
              }))}
              category="value"
              index="name"
              colors={["blue", "slate", "emerald", "rose"]}
              showLabel={false}
            />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Signing funnel"
          description="Signers at each step"
          state={funnel.sent === 0 ? "empty" : "ready"}
          emptyHint="Nothing sent in this period."
          tableAlt={{
            columns: ["Step", "Signers"],
            rows: stages.map((s) => [s.Stage, s.Signers]),
          }}
        >
          {mounted && (
            <BarChart
              className="h-40"
              data={stages}
              index="Stage"
              categories={["Signers"]}
              colors={[chartColors.primary]}
              layout="vertical"
              allowDecimals={false}
              showLegend={false}
            />
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {stages
              .slice(1)
              .map(
                (s, i) =>
                  `${lost(i + 1)}% drop before ${s.Stage.toLowerCase()}`,
              )
              .join(" · ")}
          </p>
        </ChartCard>

        <ChartCard
          title="Slowest signers"
          description="Median hours from email to signature"
          state={data.slowest.length ? "ready" : "empty"}
          emptyHint="Appears after the first signatures."
        >
          <ul className="space-y-2 text-sm">
            {data.slowest.map((s) => (
              <li key={s.email} className="flex justify-between gap-3">
                <span className="truncate">
                  <span className="font-medium">{s.name || s.email}</span>
                  {s.name && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {s.email}
                    </span>
                  )}
                </span>
                <span className="shrink-0">
                  {formatHours(s.medianHours)}
                  <span className="ml-1 text-xs text-muted-foreground">
                    · {s.signed} signed
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <h3 className="text-sm font-semibold">Documents</h3>
          <div className="flex flex-wrap items-center gap-3">
            <SearchBox placeholder="Search documents" />
            <SearchBox placeholder="Search signer" param="signer" />
            <CsvButton onExport={exportCsv} disabled={noData} />
          </div>
        </div>
        <div className="px-4 pb-2">
          <FilterChips
            groups={[
              {
                key: "status",
                label: "Status",
                multi: true,
                options: [
                  { value: "DRAFT", label: "Draft" },
                  { value: "PENDING", label: "Pending" },
                  { value: "COMPLETE", label: "Complete" },
                  { value: "CANCELLED", label: "Cancelled" },
                ],
              },
              {
                key: "stuck",
                label: "Waiting",
                options: [{ value: "1", label: "Stuck 3+ days" }],
              },
            ]}
          />
        </div>
        <div className="overflow-x-auto px-4 pb-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Signed</TableHead>
                <TableHead>Waiting on</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.envelopes.items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-sm text-muted-foreground"
                  >
                    No documents match these filters.
                  </TableCell>
                </TableRow>
              )}
              {data.envelopes.items.map((e) => (
                <TableRow key={e.templateId}>
                  <TableCell>
                    <span className="flex items-center">
                      <span className="mr-3">
                        <FileIcon type="application/pdf" />
                      </span>
                      {e.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[e.status]}>{e.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {e.signers.signed} / {e.signers.total}
                  </TableCell>
                  <TableCell>
                    {e.waitingOn.length === 0 ? (
                      "—"
                    ) : (
                      <span
                        className={e.stuck ? "font-medium text-amber-700" : ""}
                      >
                        {e.waitingOn[0]?.name || e.waitingOn[0]?.email}
                        {e.waitingOn.length > 1 &&
                          ` +${e.waitingOn.length - 1}`}
                        {" · "}
                        {Math.max(...e.waitingOn.map((w) => w.waitingDays))}{" "}
                        days
                      </span>
                    )}
                  </TableCell>
                  <TableCell suppressHydrationWarning>
                    {dayjsExt().to(e.createdAt)}
                  </TableCell>
                  <TableCell className="flex gap-x-2">
                    <Link
                      className={buttonVariants()}
                      href={`/${companyPublicId}/documents/esign/v/${e.publicId}`}
                    >
                      View
                    </Link>
                    {e.status === "DRAFT" && (
                      <Link
                        className={buttonVariants()}
                        href={`/${companyPublicId}/documents/esign/${e.publicId}`}
                      >
                        Edit
                      </Link>
                    )}
                    <TemplateCancelButton
                      templateId={e.templateId}
                      publicId={e.publicId}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager
            nextCursor={data.envelopes.nextCursor}
            hasCursor={!!filters.cursor}
          />
        </div>
      </Card>
    </div>
  );
};
