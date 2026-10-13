"use client";

import {
  ChartCard,
  CsvButton,
  FilterChips,
  Pager,
  SearchBox,
  StatCard,
  chartColors,
  formatCount,
} from "@/components/analytics";
import EmptyState from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { toCsv } from "@/server/analytics/csv";
import { api } from "@/trpc/react";
import { RiPieChartFill } from "@remixicon/react";
import { BarChart } from "@tremor/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  type CapTableData,
  HoldersTable,
  formatPct,
  formatUsd,
} from "./holders-table";
import { topHolders } from "./top-holders";

const EXPORT_LIMIT = 5000;
const PAGE = 50;

type Filters = {
  classId?: string;
  holderType?: "INDIVIDUAL" | "INSTITUTION";
  search?: string;
};

type Props = {
  publicId: string;
  // the current page for the URL filters
  data: CapTableData;
  // the ten largest holders, unfiltered (feeds the ownership bar)
  top: CapTableData["rows"];
  filters: Filters;
  hasCursor: boolean;
};

export const CapTableView = ({
  publicId,
  data,
  top,
  filters,
  hasCursor,
}: Props) => {
  const { totals, classes } = data;

  if (totals.issued === 0) {
    return (
      <EmptyState
        icon={<RiPieChartFill />}
        title="No shares issued yet."
        subtitle="Your cap table fills in as you issue shares to holders."
      >
        <Button asChild>
          <Link href={`/${publicId}/securities/shares`}>
            Go to Securities: Shares
          </Link>
        </Button>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Cap table" className="flex flex-col gap-4">
        <Header data={data} />
        <OwnershipBar rows={top} totalIssued={totals.issued} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterChips
            groups={[
              {
                key: "class",
                label: "Share class",
                options: classes.map((c) => ({ value: c.id, label: c.name })),
              },
              {
                key: "type",
                label: "Holder type",
                options: [
                  { value: "INDIVIDUAL", label: "Individual" },
                  { value: "INSTITUTION", label: "Institution" },
                ],
              },
            ]}
          />
          <div className="flex items-center gap-2">
            <SearchBox placeholder="Search holders" />
            <ExportButton data={data} filters={filters} />
          </div>
        </div>
        <HoldersTable data={data} />
        <Pager nextCursor={data.nextCursor} hasCursor={hasCursor} />
      </section>
    </div>
  );
};

const Header = ({ data }: { data: CapTableData }) => {
  const { totals } = data;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatCard
        label="Issued shares"
        value={formatCount(totals.issued)}
        hint="Shares that have been issued to holders and are currently active."
      />
      <StatCard
        label="Fully diluted"
        value={formatCount(totals.fullyDiluted)}
        hint="Issued shares plus outstanding options and the unallocated option pool."
      />
      <StatCard
        label="Options"
        value={formatCount(totals.options)}
        hint="Options granted to holders that have not been exercised or cancelled."
      />
      <StatCard
        label="Unallocated pool"
        value={formatCount(totals.unallocatedPool)}
        hint="Shares reserved in your equity plans that have not been granted yet."
      />
      <StatCard
        label="Convertible capital"
        value={formatUsd(totals.convertibleCapital)}
        hint="Not shares yet. Converts in your next round."
      />
    </div>
  );
};

const OwnershipBar = ({
  rows,
  totalIssued,
}: {
  rows: CapTableData["rows"];
  totalIssued: number;
}) => {
  // Tremor charts measure the DOM: render after mount only
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const slices = topHolders(
    rows.map((r) => ({ name: r.name, shares: r.issued })),
    totalIssued,
  );
  const data = slices.map((s) => ({
    Holder: s.name,
    "% of issued": Math.round(s.pct * 10000) / 100,
  }));

  return (
    <ChartCard
      title="Ownership by holder"
      description="Top 10 holders, share of issued shares"
      state={slices.length ? "ready" : "empty"}
      emptyHint="Issue shares to see ownership by holder."
      tableAlt={{
        columns: ["Holder", "Shares", "% of issued"],
        rows: slices.map((s) => [s.name, s.shares, formatPct(s.pct)]),
      }}
    >
      {mounted && (
        <BarChart
          className="h-72"
          data={data}
          index="Holder"
          categories={["% of issued"]}
          colors={[chartColors.primary]}
          layout="vertical"
          showLegend={false}
          valueFormatter={(v) => `${v.toFixed(2)}%`}
          yAxisWidth={110}
        />
      )}
    </ChartCard>
  );
};

// Walks the keyset cursor for the current filter, 50 rows per call.
const ExportButton = ({
  data,
  filters,
}: { data: CapTableData; filters: Filters }) => {
  const utils = api.useUtils();

  const onExport = async () => {
    const rows: CapTableData["rows"] = [];
    let cursor: string | undefined;
    while (rows.length < EXPORT_LIMIT) {
      const page = await utils.captable.table.fetch({
        ...filters,
        cursor,
        limit: PAGE,
      });
      rows.push(...page.rows);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    const exported = rows.slice(0, EXPORT_LIMIT);
    return {
      filename: "cap-table.csv",
      csv: toCsv(
        exported.map((r) => ({
          name: r.name,
          email: r.email,
          ...Object.fromEntries(
            data.classes.map((c) => [c.id, r.byClass[c.id] ?? 0]),
          ),
          options: r.options,
          issued: r.issued,
          pct_issued: Math.round(r.pctIssued * 10000) / 100,
          fully_diluted: r.fullyDiluted,
          pct_fully_diluted: Math.round(r.pctFullyDiluted * 10000) / 100,
          convertible_capital: r.convertibleCapital,
        })),
        [
          { key: "name", label: "Holder" },
          { key: "email", label: "Email" },
          ...data.classes.map((c) => ({ key: c.id, label: c.name })),
          { key: "options", label: "Options" },
          { key: "issued", label: "Issued" },
          { key: "pct_issued", label: "% issued" },
          { key: "fully_diluted", label: "Fully diluted" },
          { key: "pct_fully_diluted", label: "% fully diluted" },
          { key: "convertible_capital", label: "Convertible capital" },
        ],
      ),
    };
  };

  return <CsvButton onExport={onExport} />;
};
