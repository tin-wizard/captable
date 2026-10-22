"use client";

import { dayjsExt } from "@/common/dayjs";
import { countryName, formatDuration } from "@/components/activity/format";
import {
  ChartCard,
  CsvButton,
  FilterChips,
  Pager,
  RangeTabs,
  SearchBox,
  StatCard,
  chartColors,
  engagementColors,
  formatCompact,
  formatPercent,
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
import { toCsv } from "@/server/analytics/csv";
import type {
  DocumentAnalytics as Data,
  ViewerRow,
} from "@/server/analytics/document";
import { delta } from "@/server/analytics/range";
import { api } from "@/trpc/react";
import { AreaChart, BarChart, BarList, CategoryBar } from "@tremor/react";
import { useEffect, useState } from "react";
import { ViewerSheet } from "./viewer-sheet";

type Props = {
  data: Data;
  kind: "DATA_ROOM" | "UPDATE";
  targetPublicId: string;
  // the URL-derived filters, passed back for the CSV export
  filters: {
    range?: "7d" | "30d" | "90d" | "custom";
    from?: string;
    to?: string;
    includeBots?: boolean;
    viewerStatus?: "all" | "returned" | "unopened";
    country?: string[];
    search?: string;
    cursor?: string;
  };
  roomName: string;
  // show the Downloads KPI when downloads are on (or any happened)
  allowDownload?: boolean;
  // show the NDA column and CSV field
  requireNda?: boolean;
};

const LABEL_STYLE = {
  hot: "bg-rose-50 text-rose-800",
  warm: "bg-amber-50 text-amber-800",
  cold: "bg-muted text-muted-foreground",
} as const;

// ranges are UTC days: format them in UTC so the label matches the series
const utcDay = (iso: string, year: boolean) =>
  new Date(iso).toLocaleDateString("en", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(year && { year: "numeric" }),
  });

// Biggest fall in viewers from one page to the next: "most people stop here".
const dropOff = (byPage: { page: number; viewers: number }[]) => {
  let best: { after: number; lost: number } | null = null;
  for (let i = 1; i < byPage.length; i++) {
    const lost = (byPage[i - 1]?.viewers ?? 0) - (byPage[i]?.viewers ?? 0);
    if (lost > 0 && (!best || lost > best.lost))
      best = { after: byPage[i - 1]?.page ?? i, lost };
  }
  return best;
};

export const DocumentAnalytics = ({
  data,
  kind,
  targetPublicId,
  filters,
  roomName,
  allowDownload = false,
  requireNda = false,
}: Props) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerRow | null>(null);
  const utils = api.useContext();

  const { kpis } = data;
  const noVisits = kpis.visits === 0;
  const showDownloads = allowDownload || kpis.downloads > 0;
  const doc =
    data.documents?.find((d) => d.bucketId === selectedDoc) ??
    data.documents?.[0] ??
    null;
  const drop = doc ? dropOff(doc.byPage) : null;
  const mix = data.engagementMix;
  const mixTotal = mix.hot + mix.warm + mix.cold + mix.unopened;

  const exportCsv = async () => {
    const rows: ViewerRow[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const res = await utils.analytics.document.fetch({
        kind,
        targetPublicId,
        ...filters,
        cursor,
        limit: 50,
      });
      if (!res) break;
      rows.push(...res.viewers.items);
      if (!res.viewers.nextCursor) break;
      cursor = res.viewers.nextCursor;
    }
    const csv = toCsv(
      rows.map((r) => ({
        viewer: r.label,
        email: r.email,
        visits: r.visits,
        active_seconds: r.activeSeconds,
        pages_reached: r.pagesReached,
        engagement: r.engagementLabel,
        score: r.score,
        first_seen: r.firstSeen,
        last_seen: r.lastSeen,
        countries: r.countries.join(" "),
        downloads: r.downloads,
        nda_accepted: r.ndaAccepted ? "yes" : "no",
      })),
      [
        { key: "viewer", label: "Viewer" },
        { key: "email", label: "Email" },
        { key: "visits", label: "Visits" },
        { key: "active_seconds", label: "Active seconds" },
        { key: "pages_reached", label: "Pages reached" },
        { key: "engagement", label: "Engagement" },
        { key: "score", label: "Score" },
        { key: "first_seen", label: "First seen" },
        { key: "last_seen", label: "Last seen" },
        { key: "countries", label: "Countries" },
        { key: "downloads", label: "Downloads" },
        ...(requireNda ? [{ key: "nda_accepted", label: "NDA accepted" }] : []),
      ],
    );
    const slug = roomName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return {
      filename: `${slug}-viewers-${data.range.from.slice(
        0,
        10,
      )}-${data.range.to.slice(0, 10)}.csv`,
      csv,
    };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangeTabs />
        <CsvButton
          onExport={exportCsv}
          disabled={noVisits && !data.viewers.items.length}
        />
      </div>

      <section
        aria-label="Key numbers"
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        <StatCard
          label="Unique viewers"
          value={formatCompact(kpis.viewers)}
          delta={delta(kpis.viewers, kpis.previous.viewers)}
          spark={data.series.map((s) => ({ index: s.day, value: s.viewers }))}
        />
        <StatCard
          label="Visits"
          value={formatCompact(kpis.visits)}
          delta={delta(kpis.visits, kpis.previous.visits)}
          spark={data.series.map((s) => ({ index: s.day, value: s.visits }))}
          hint={
            kpis.botsHidden
              ? `${kpis.botsHidden} automated visit${
                  kpis.botsHidden > 1 ? "s" : ""
                } hidden (mail scanners and link previews).`
              : undefined
          }
        />
        <StatCard
          label="Avg time per visit"
          value={formatDuration(kpis.avgActiveSeconds)}
          delta={delta(kpis.avgActiveSeconds, kpis.previous.avgActiveSeconds)}
          hint="Time the page was open and being used."
        />
        <StatCard
          label="Completion rate"
          value={formatPercent(kpis.completionRate)}
          hint="Share of viewers who reached the last page of a document. Shown once page detail has been recorded."
        />
        {showDownloads && (
          <StatCard
            label="Downloads"
            value={formatCompact(kpis.downloads)}
            hint="Files downloaded with the Download button in this period."
          />
        )}
      </section>

      <ChartCard
        title="Views over time"
        description={`${utcDay(data.range.from, false)} – ${utcDay(
          data.range.to,
          true,
        )}`}
        state={noVisits ? "empty" : "ready"}
        emptyHint="No views in this period. Recipients who haven't opened it appear below."
        tableAlt={{
          columns: ["Day", "Visits", "Viewers"],
          rows: data.series.map((s) => [s.day, s.visits, s.viewers]),
        }}
      >
        {mounted && (
          <AreaChart
            className="h-56"
            data={data.series.map((s) => ({
              Day: dayjsExt(s.day).format("MMM D"),
              Visits: s.visits,
              Viewers: s.viewers,
            }))}
            index="Day"
            categories={["Visits", "Viewers"]}
            colors={[chartColors.primary, chartColors.secondary]}
            allowDecimals={false}
            yAxisWidth={32}
          />
        )}
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Engagement"
          description="Hot, warm and cold viewers, and who has not opened it"
          state={mixTotal === 0 ? "empty" : "ready"}
          emptyHint="Share it with someone to see engagement."
        >
          <CategoryBar
            values={[mix.hot, mix.warm, mix.cold, mix.unopened]}
            colors={[
              engagementColors.hot,
              engagementColors.warm,
              engagementColors.cold,
              engagementColors.unopened,
            ]}
            showLabels={false}
            className="mt-2"
          />
          <ul className="mt-4 grid grid-cols-2 gap-2 text-sm">
            {(
              [
                ["Hot", mix.hot, "bg-rose-500"],
                ["Warm", mix.warm, "bg-amber-500"],
                ["Cold", mix.cold, "bg-slate-400"],
                ["Not opened", mix.unopened, "bg-gray-300"],
              ] as const
            ).map(([name, n, dot]) => (
              <li key={name} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 rounded-full ${dot}`}
                  />
                  {name}
                </span>
                <span className="font-medium">{n}</span>
              </li>
            ))}
          </ul>
        </ChartCard>

        <ChartCard
          title="Where they are"
          description="Visits by country"
          state={data.countries.length ? "ready" : "empty"}
          emptyHint="Location appears once visits are recorded."
          tableAlt={{
            columns: ["Country", "Visits"],
            rows: data.countries.map((c) => [
              countryName(c.country) ?? c.country,
              c.visits,
            ]),
          }}
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

      {kind === "DATA_ROOM" && (
        <ChartCard
          title="Documents and pages"
          description={
            data.legacyDetailFrom
              ? `Page detail starts ${dayjsExt(data.legacyDetailFrom).format(
                  "MMM D",
                )}; earlier visits are not broken down`
              : "Which documents are read and where people stop"
          }
          state={doc ? "ready" : "empty"}
          emptyHint="Page-by-page detail appears as new visits are recorded."
        >
          {doc && (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead>
                      <TableHead>Viewers</TableHead>
                      <TableHead>Avg time</TableHead>
                      <TableHead>Pages</TableHead>
                      <TableHead>Completion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.documents?.map((d) => (
                      <TableRow
                        key={d.bucketId}
                        data-state={
                          d.bucketId === doc.bucketId ? "selected" : undefined
                        }
                      >
                        <TableCell>
                          <button
                            type="button"
                            aria-pressed={d.bucketId === doc.bucketId}
                            onClick={() => setSelectedDoc(d.bucketId)}
                            className="text-left font-medium underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
                          >
                            {d.name}
                          </button>
                        </TableCell>
                        <TableCell>{d.viewers}</TableCell>
                        <TableCell>{formatDuration(d.avgSeconds)}</TableCell>
                        <TableCell>{d.pages ?? "—"}</TableCell>
                        <TableCell>{formatPercent(d.completion)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {doc.byPage.length > 0 && (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">
                    Average seconds per page for {doc.name}
                    {drop &&
                      ` · most viewers stop after page ${drop.after} (${drop.lost} drop off)`}
                  </p>
                  {mounted && (
                    <BarChart
                      className="h-48"
                      data={doc.byPage.map((p) => ({
                        Page: String(p.page),
                        Seconds: Math.round(p.seconds),
                        Viewers: p.viewers,
                      }))}
                      index="Page"
                      categories={["Seconds"]}
                      colors={[chartColors.primary]}
                      yAxisWidth={32}
                      allowDecimals={false}
                    />
                  )}
                  <table className="sr-only">
                    <caption>Time and viewers per page of {doc.name}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Page</th>
                        <th scope="col">Seconds</th>
                        <th scope="col">Viewers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.byPage.map((p) => (
                        <tr key={p.page}>
                          <td>{p.page}</td>
                          <td>{Math.round(p.seconds)}</td>
                          <td>{p.viewers}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </ChartCard>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <h3 className="text-sm font-semibold">Viewers</h3>
          <div className="flex flex-wrap items-center gap-3">
            <FilterChips
              groups={[
                {
                  key: "status",
                  label: "Show",
                  options: [
                    { value: "returned", label: "Returned" },
                    { value: "unopened", label: "Not opened" },
                  ],
                },
                {
                  key: "bots",
                  label: "Automated",
                  options: [{ value: "1", label: "Include" }],
                },
              ]}
            />
            <SearchBox placeholder="Search viewers" />
          </div>
        </div>
        {data.countries.length > 1 && (
          <div className="px-4 pb-2">
            <FilterChips
              groups={[
                {
                  key: "country",
                  label: "Country",
                  multi: true,
                  options: data.countries.map((c) => ({
                    value: c.country,
                    label: countryName(c.country) ?? c.country,
                  })),
                },
              ]}
            />
          </div>
        )}
        <div className="overflow-x-auto px-4 pb-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Viewer</TableHead>
                <TableHead>Engagement</TableHead>
                <TableHead>Visits</TableHead>
                <TableHead>Active time</TableHead>
                <TableHead>Pages</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Where</TableHead>
                <TableHead>Downloads</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.viewers.items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-sm text-muted-foreground"
                  >
                    No viewers match these filters.
                  </TableCell>
                </TableRow>
              )}
              {data.viewers.items.map((v) => (
                <TableRow key={v.recipientId}>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => setViewer(v)}
                      className="text-left focus-visible:outline focus-visible:outline-2"
                    >
                      <span className="block font-medium">{v.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {v.email}
                        {v.stakeholder?.shares != null &&
                          ` · ${formatCompact(v.stakeholder.shares)} shares`}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell>
                    {v.visits === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        Not opened
                      </span>
                    ) : (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          LABEL_STYLE[v.engagementLabel]
                        }`}
                      >
                        {v.engagementLabel} · {v.score}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{v.visits}</TableCell>
                  <TableCell>{formatDuration(v.activeSeconds)}</TableCell>
                  <TableCell>{v.pagesReached ?? "—"}</TableCell>
                  <TableCell>
                    {v.lastSeen ? dayjsExt().to(v.lastSeen) : "—"}
                  </TableCell>
                  <TableCell>
                    {v.countries.map((c) => countryName(c)).join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    {v.downloads}
                    {requireNda && v.ndaAccepted && (
                      <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        NDA accepted
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager
            nextCursor={data.viewers.nextCursor}
            hasCursor={!!filters.cursor}
          />
        </div>
      </Card>

      <ViewerSheet
        kind={kind}
        targetPublicId={targetPublicId}
        viewer={viewer}
        onClose={() => setViewer(null)}
      />
    </div>
  );
};
