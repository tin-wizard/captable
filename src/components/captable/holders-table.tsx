"use client";

import { formatCount } from "@/components/analytics";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RouterOutputs } from "@/trpc/shared";

export type CapTableData = RouterOutputs["captable"]["table"];

export const formatUsd = (n: number) => `$${formatCount(n)}`;

export const formatPct = (ratio: number) => `${(ratio * 100).toFixed(2)}%`;

const num = "text-right tabular-nums";

export const HoldersTable = ({
  data,
  showPool = false,
}: {
  data: CapTableData;
  // only when no filter is active and this is the last page, so rows + pool = 100 %
  showPool?: boolean;
}) => {
  const { classes, rows, totals } = data;
  return (
    <Card className="overflow-x-auto">
      <Table aria-label="Cap table by holder">
        <TableHeader>
          <TableRow>
            <TableHead>Holder</TableHead>
            {classes.map((c) => (
              <TableHead key={c.id} className={num}>
                {c.name}
              </TableHead>
            ))}
            <TableHead className={num}>Options</TableHead>
            <TableHead className={num}>Issued</TableHead>
            <TableHead className={num}>% issued</TableHead>
            <TableHead className={num}>Fully diluted</TableHead>
            <TableHead className={num}>% fully diluted</TableHead>
            <TableHead className={num}>Convertible capital</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={classes.length + 7}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                No shareholders yet, or none match these filters.
              </TableCell>
            </TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={r.stakeholderId}>
              <TableCell className="min-w-48">
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.email}</div>
              </TableCell>
              {classes.map((c) => (
                <TableCell key={c.id} className={num}>
                  {formatCount(r.byClass[c.id] ?? 0)}
                </TableCell>
              ))}
              <TableCell className={num}>{formatCount(r.options)}</TableCell>
              <TableCell className={num}>{formatCount(r.issued)}</TableCell>
              <TableCell className={num}>{formatPct(r.pctIssued)}</TableCell>
              <TableCell className={num}>
                {formatCount(r.fullyDiluted)}
              </TableCell>
              <TableCell className={num}>
                {formatPct(r.pctFullyDiluted)}
              </TableCell>
              <TableCell className={num}>
                {formatUsd(r.convertibleCapital)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          {showPool && (
            <TableRow className="text-muted-foreground">
              <TableCell className="font-normal">
                Unallocated option pool
              </TableCell>
              {classes.map((c) => (
                <TableCell key={c.id} />
              ))}
              <TableCell />
              <TableCell />
              <TableCell />
              <TableCell className={num}>
                {formatCount(totals.unallocatedPool)}
              </TableCell>
              <TableCell className={num}>
                {formatPct(
                  totals.fullyDiluted > 0
                    ? totals.unallocatedPool / totals.fullyDiluted
                    : 0,
                )}
              </TableCell>
              <TableCell />
            </TableRow>
          )}
          <TableRow>
            <TableCell className="font-medium">Company total</TableCell>
            {classes.map((c) => (
              <TableCell key={c.id} className={num}>
                {formatCount(totals.byClass[c.id] ?? 0)}
              </TableCell>
            ))}
            <TableCell className={num}>{formatCount(totals.options)}</TableCell>
            <TableCell className={num}>{formatCount(totals.issued)}</TableCell>
            <TableCell className={num}>100.00%</TableCell>
            <TableCell className={num}>
              {formatCount(totals.fullyDiluted)}
            </TableCell>
            <TableCell className={num}>100.00%</TableCell>
            <TableCell className={num}>
              {formatUsd(totals.convertibleCapital)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </Card>
  );
};
