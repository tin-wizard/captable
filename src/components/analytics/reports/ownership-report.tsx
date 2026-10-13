"use client";

import { CsvButton } from "@/components/analytics";
import { OwnershipCard } from "@/components/dashboard/overview/ownership-card";
import { SummaryTable } from "@/components/dashboard/overview/summary-table";
import { toCsv } from "@/server/analytics/csv";
import type { Holdings } from "@/server/analytics/holdings";

export const OwnershipReport = ({ holdings }: { holdings: Holdings }) => {
  const exportClasses = async () => ({
    filename: "ownership-by-class.csv",
    csv: toCsv(
      holdings.byClass.map((c) => ({
        class: c.name,
        authorized: c.authorized,
        issued: c.shares,
        ownership_pct: Math.round(c.pct * 1000) / 10,
        issued_value: c.issuedValue,
      })),
      [
        { key: "class", label: "Share class" },
        { key: "authorized", label: "Authorized" },
        { key: "issued", label: "Issued" },
        { key: "ownership_pct", label: "Ownership %" },
        { key: "issued_value", label: "Issued value" },
      ],
    ),
  });
  const exportHolders = async () => ({
    filename: "ownership-by-stakeholder.csv",
    csv: toCsv(
      holdings.byStakeholder.map((s) => ({
        stakeholder: s.name,
        shares: s.shares,
        ownership_pct: Math.round(s.pct * 1000) / 10,
      })),
      [
        { key: "stakeholder", label: "Stakeholder" },
        { key: "shares", label: "Shares" },
        { key: "ownership_pct", label: "Ownership %" },
      ],
    ),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        <CsvButton onExport={exportClasses} label="Export by class" />
        <CsvButton onExport={exportHolders} label="Export by stakeholder" />
      </div>
      <OwnershipCard
        byClass={holdings.byClass}
        byStakeholder={holdings.byStakeholder}
      />
      <SummaryTable rows={holdings.byClass} />
      <p className="text-xs text-muted-foreground">
        Stakeholder export lists the top holders and an Others line; the full
        list is under Stakeholders.
      </p>
    </div>
  );
};
