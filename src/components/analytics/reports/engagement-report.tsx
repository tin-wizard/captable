"use client";

import { dayjsExt } from "@/common/dayjs";
import { countryName, formatDuration } from "@/components/activity/format";
import {
  ChartCard,
  CsvButton,
  RangeTabs,
  StatCard,
  chartColors,
  formatCompact,
} from "@/components/analytics";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CompanyEngagement } from "@/server/analytics/company";
import { toCsv } from "@/server/analytics/csv";
import { delta } from "@/server/analytics/range";
import { AreaChart, BarList, CategoryBar } from "@tremor/react";
import Link from "next/link";
import { useEffect, useState } from "react";

export const EngagementReport = ({
  data,
  companyPublicId,
}: {
  data: CompanyEngagement;
  companyPublicId: string;
}) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { kpis, byKind } = data;
  const empty = kpis.visits === 0;
  const kindTotal = byKind.DATA_ROOM + byKind.UPDATE + byKind.ESIGN;

  const exportCsv = async () => ({
    filename: `engagement-${data.range.from.slice(0, 10)}-${data.range.to.slice(
      0,
      10,
    )}.csv`,
    csv: toCsv(
      data.topItems.map((i) => ({
        type: i.kind === "DATA_ROOM" ? "Data room" : "Update",
        name: i.name,
        viewers: i.viewers,
        visits: i.visits,
        avg_seconds: Math.round(i.avgActiveSeconds),
        last_viewed: i.lastViewedAt,
        not_opened: i.unopened,
      })),
      [
        { key: "type", label: "Type" },
        { key: "name", label: "Name" },
        { key: "viewers", label: "Viewers" },
        { key: "visits", label: "Visits" },
        { key: "avg_seconds", label: "Average active seconds" },
        { key: "last_viewed", label: "Last viewed" },
        { key: "not_opened", label: "Not opened yet" },
      ],
    ),
  });

  return (
    <div className="space-y-6">
      <RangeTabs />
      <section
        aria-label="Key numbers"
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
      >
        <StatCard
          label="Visits"
          value={formatCompact(kpis.visits)}
          delta={delta(kpis.visits, kpis.previous.visits)}
          spark={data.series.map((s) => ({ index: s.day, value: s.visits }))}
        />
        <StatCard
          label="Unique viewers"
          value={formatCompact(kpis.viewers)}
          delta={delta(kpis.viewers, kpis.previous.viewers)}
        />
        <StatCard
          label="Avg time per visit"
          value={formatDuration(kpis.avgActiveSeconds)}
          delta={delta(kpis.avgActiveSeconds, kpis.previous.avgActiveSeconds)}
        />
      </section>

      <ChartCard
        title="Views over time"
        state={empty ? "empty" : "ready"}
        emptyHint="No views in this period."
        tableAlt={{
          columns: ["Day", "Visits"],
          rows: data.series.map((s) => [s.day, s.visits]),
        }}
      >
        {mounted && (
          <AreaChart
            className="h-56"
            data={data.series.map((s) => ({
              Day: dayjsExt(s.day).format("MMM D"),
              Visits: s.visits,
            }))}
            index="Day"
            categories={["Visits"]}
            colors={[chartColors.primary]}
            allowDecimals={false}
            yAxisWidth={32}
          />
        )}
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="What gets viewed"
          description="Visits by type"
          state={kindTotal === 0 ? "empty" : "ready"}
          emptyHint="Nothing viewed in this period."
        >
          <CategoryBar
            values={[byKind.DATA_ROOM, byKind.UPDATE, byKind.ESIGN]}
            colors={["blue", "orange", "emerald"]}
            showLabels={false}
          />
          <ul className="mt-3 space-y-1 text-sm">
            <li className="flex justify-between">
              <span>Data rooms</span>
              <span className="font-medium">{byKind.DATA_ROOM}</span>
            </li>
            <li className="flex justify-between">
              <span>Updates</span>
              <span className="font-medium">{byKind.UPDATE}</span>
            </li>
            <li className="flex justify-between">
              <span>E-sign documents</span>
              <span className="font-medium">{byKind.ESIGN}</span>
            </li>
          </ul>
        </ChartCard>
        <ChartCard
          title="Where they are"
          state={data.countries.length ? "ready" : "empty"}
          emptyHint="Location appears once visits are recorded."
        >
          <BarList
            data={data.countries.map((c) => ({
              name: countryName(c.country) ?? c.country,
              value: c.visits,
            }))}
            color="blue"
          />
        </ChartCard>
      </div>

      <Card>
        <div className="flex items-center justify-between p-4">
          <h3 className="text-sm font-semibold">Most viewed</h3>
          <CsvButton
            onExport={exportCsv}
            disabled={data.topItems.length === 0}
          />
        </div>
        <div className="overflow-x-auto px-4 pb-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Viewers</TableHead>
                <TableHead>Visits</TableHead>
                <TableHead>Avg time</TableHead>
                <TableHead>Not opened</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.topItems.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-sm text-muted-foreground"
                  >
                    Nothing shared yet.
                  </TableCell>
                </TableRow>
              )}
              {data.topItems.map((i) => (
                <TableRow key={`${i.kind}-${i.targetId}`}>
                  <TableCell>
                    <Link
                      className="font-medium underline-offset-2 hover:underline"
                      href={
                        i.kind === "DATA_ROOM"
                          ? `/${companyPublicId}/documents/data-rooms/${i.publicId}`
                          : `/${companyPublicId}/updates/${i.publicId}`
                      }
                    >
                      {i.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {i.kind === "DATA_ROOM" ? "Data room" : "Update"}
                  </TableCell>
                  <TableCell>{i.viewers}</TableCell>
                  <TableCell>{i.visits}</TableCell>
                  <TableCell>{formatDuration(i.avgActiveSeconds)}</TableCell>
                  <TableCell>{i.unopened || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
};
