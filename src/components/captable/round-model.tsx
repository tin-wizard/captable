"use client";

import {
  ChartCard,
  CsvButton,
  StatCard,
  chartColors,
  formatCount,
} from "@/components/analytics";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toCsv } from "@/server/analytics/csv";
import { api } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/shared";
import { BarChart } from "@tremor/react";
import { useEffect, useState } from "react";
import { formatPct, formatUsd } from "./holders-table";
import {
  type RoundFormValues,
  type RoundInputErrors,
  formatDilution,
  sortHolders,
  validateRoundInput,
} from "./round-input";

type Proforma = RouterOutputs["captable"]["proforma"];
type HolderRow = Proforma["holders"][number];

const num = "text-right tabular-nums";
const BOUND_LABEL = {
  cap: "valuation cap",
  discount: "discount",
  round: "round price",
} as const;
const CHART_HOLDERS = 8;

const friendlyError = (message: string) =>
  message === "Add shares first"
    ? "Add shares first. The model needs issued shares to work from."
    : message;

export const RoundModel = () => {
  const utils = api.useUtils();
  const [form, setForm] = useState<RoundFormValues>({
    preMoney: "",
    newMoney: "",
    poolTargetPct: "",
    asOf: "",
  });
  const [errors, setErrors] = useState<RoundInputErrors>({});
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<Proforma | null>(null);

  const set =
    (k: keyof RoundFormValues) => (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const calculate = async () => {
    const parsed = validateRoundInput(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    setFailure(null);
    setLoading(true);
    try {
      setResult(await utils.captable.proforma.fetch(parsed.value));
    } catch (e) {
      setResult(null);
      setFailure(
        friendlyError(
          e instanceof Error ? e.message : "Could not run the model.",
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section aria-label="Model a round" className="flex flex-col gap-4">
      <div>
        <h3 className="font-medium">Model a round</h3>
        <p className="text-sm text-muted-foreground">
          See how a new priced round dilutes each holder. Active SAFEs and notes
          convert automatically.
        </p>
      </div>

      <Card className="p-4">
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            void calculate();
          }}
        >
          <Field
            id="rm-pre"
            label="Pre-money valuation ($)"
            error={errors.preMoney}
          >
            <Input
              id="rm-pre"
              inputMode="decimal"
              placeholder="10,000,000"
              value={form.preMoney}
              onChange={set("preMoney")}
              aria-invalid={Boolean(errors.preMoney)}
            />
          </Field>
          <Field id="rm-new" label="New money ($)" error={errors.newMoney}>
            <Input
              id="rm-new"
              inputMode="decimal"
              placeholder="2,000,000"
              value={form.newMoney}
              onChange={set("newMoney")}
              aria-invalid={Boolean(errors.newMoney)}
            />
          </Field>
          <Field
            id="rm-pool"
            label="Option pool target (% post-money)"
            error={errors.poolTargetPct}
          >
            <Input
              id="rm-pool"
              inputMode="decimal"
              placeholder="10"
              value={form.poolTargetPct}
              onChange={set("poolTargetPct")}
              aria-invalid={Boolean(errors.poolTargetPct)}
            />
          </Field>
          <Field id="rm-asof" label="As of (optional)" error={errors.asOf}>
            <Input
              id="rm-asof"
              type="date"
              value={form.asOf}
              onChange={set("asOf")}
              aria-invalid={Boolean(errors.asOf)}
            />
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" disabled={loading} aria-busy={loading}>
              {loading ? "Calculating..." : "Calculate"}
            </Button>
          </div>
        </form>
      </Card>

      <p className="text-sm text-muted-foreground" role="note">
        Estimate, not legal advice. Check against your counsel's model.
      </p>

      {failure && (
        <Card className="p-4 text-sm" role="alert">
          {failure}
        </Card>
      )}
      {result && <Results result={result} />}
    </section>
  );
};

const Field = ({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    {children}
    {error && (
      <p className="text-xs text-destructive" role="alert">
        {error}
      </p>
    )}
  </div>
);

const Results = ({ result }: { result: Proforma }) => {
  if (!result.converged) {
    return (
      <Card className="p-4 text-sm" role="alert">
        Could not solve with these inputs
      </Card>
    );
  }
  const rows = sortHolders(result.holders);
  // flag a converting holder only when its name maps to exactly one row
  const nameCount = new Map<string, number>();
  for (const r of rows) nameCount.set(r.name, (nameCount.get(r.name) ?? 0) + 1);
  const flagOf = (name: string) =>
    nameCount.get(name) === 1
      ? result.conversions
          .filter((c) => c.holder === name)
          .map((c) => BOUND_LABEL[c.bound])
          .join(", ")
      : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Price per share"
          value={`$${result.price.toFixed(4)}`}
          hint="The price new investors pay in this round."
        />
        <StatCard
          label="Post-money valuation"
          value={formatUsd(result.postMoney)}
          hint="Pre-money plus new money."
        />
        <StatCard
          label="New investor ownership"
          value={formatPct(result.newInvestorPct)}
          hint="Share of the post-money fully diluted shares."
        />
        <StatCard
          label="Pool top-up"
          value={formatCount(Math.round(result.poolTopUpShares))}
          hint="New option pool shares needed to hit the target."
        />
      </div>

      <Card className="overflow-x-auto">
        <Table aria-label="Ownership before and after the round">
          <TableHeader>
            <TableRow>
              <TableHead>Holder</TableHead>
              <TableHead className={num}>Shares before</TableHead>
              <TableHead className={num}>% before</TableHead>
              <TableHead className={num}>Shares after</TableHead>
              <TableHead className={num}>% after</TableHead>
              <TableHead className={num}>Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const flag = flagOf(r.name);
              return (
                <TableRow key={r.stakeholderId ?? `${r.name}-${i}`}>
                  <TableCell className="min-w-40 font-medium">
                    {r.name}
                    {flag && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        converts at {flag}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className={num}>
                    {formatCount(Math.round(r.sharesBefore))}
                  </TableCell>
                  <TableCell className={num}>
                    {formatPct(r.pctBefore)}
                  </TableCell>
                  <TableCell className={num}>
                    {formatCount(Math.round(r.sharesAfter))}
                  </TableCell>
                  <TableCell className={num}>{formatPct(r.pctAfter)}</TableCell>
                  <TableCell className={num}>
                    {formatDilution(r.dilutionPts)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {result.conversions.length > 0 && (
        <Card className="overflow-x-auto">
          <Table aria-label="Converting SAFEs and notes">
            <TableHeader>
              <TableRow>
                <TableHead>Converting holder</TableHead>
                <TableHead className={num}>Amount</TableHead>
                <TableHead>Converts at</TableHead>
                <TableHead className={num}>Price per share</TableHead>
                <TableHead className={num}>Shares</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.conversions.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.holder}</TableCell>
                  <TableCell className={num}>{formatUsd(c.amount)}</TableCell>
                  <TableCell>{BOUND_LABEL[c.bound]}</TableCell>
                  <TableCell className={num}>${c.price.toFixed(4)}</TableCell>
                  <TableCell className={num}>
                    {formatCount(Math.round(c.shares))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <BeforeAfterChart rows={rows} />

      <div>
        <CsvButton
          label="Export round CSV"
          onExport={async () => ({
            filename: "round-model.csv",
            csv: toCsv(
              rows.map((r) => ({
                name: r.name,
                shares_before: Math.round(r.sharesBefore),
                pct_before: Math.round(r.pctBefore * 10000) / 100,
                shares_after: Math.round(r.sharesAfter),
                pct_after: Math.round(r.pctAfter * 10000) / 100,
                change_pts: Math.round(r.dilutionPts * 100) / 100,
              })),
              [
                { key: "name", label: "Holder" },
                { key: "shares_before", label: "Shares before" },
                { key: "pct_before", label: "% before" },
                { key: "shares_after", label: "Shares after" },
                { key: "pct_after", label: "% after" },
                { key: "change_pts", label: "Change (pts)" },
              ],
            ),
          })}
        />
      </div>
    </div>
  );
};

const BeforeAfterChart = ({ rows }: { rows: HolderRow[] }) => {
  // Tremor charts measure the DOM: render after mount only
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const people = rows.filter((r) => r.stakeholderId !== null);
  const shown = [
    ...people.slice(0, CHART_HOLDERS),
    ...rows.filter((r) => r.stakeholderId === null),
  ];
  const pct = (v: number) => Math.round(v * 10000) / 100;
  const data = shown.map((r) => ({
    Holder: r.name,
    Before: pct(r.pctBefore),
    After: pct(r.pctAfter),
  }));

  return (
    <ChartCard
      title="Before vs after"
      description="Largest holders, pool and new investors, share of fully diluted shares"
      state={shown.length ? "ready" : "empty"}
      tableAlt={{
        columns: ["Holder", "% before", "% after"],
        rows: shown.map((r) => [
          r.name,
          formatPct(r.pctBefore),
          formatPct(r.pctAfter),
        ]),
      }}
    >
      {mounted && (
        <BarChart
          className="h-80"
          data={data}
          index="Holder"
          categories={["Before", "After"]}
          colors={[chartColors.muted, chartColors.primary]}
          layout="vertical"
          valueFormatter={(v) => `${v.toFixed(2)}%`}
          yAxisWidth={110}
        />
      )}
    </ChartCard>
  );
};
