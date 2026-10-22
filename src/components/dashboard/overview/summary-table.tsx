import {
  formatCompact,
  formatCount,
  formatMoney,
  formatPercent,
} from "@/components/analytics";
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

type Row = {
  shareClassId: string;
  name: string;
  shares: number;
  pct: number;
  authorized: number;
  issuedValue: number;
};

export const SummaryTable = ({ rows }: { rows: Row[] }) => {
  if (rows.length === 0) {
    return (
      <Card className="mt-4 p-6 text-sm text-muted-foreground">
        No share classes yet. Add one under Share classes to see your summary.
      </Card>
    );
  }
  const totalShares = rows.reduce((n, r) => n + r.shares, 0);
  const totalValue = rows.reduce((n, r) => n + r.issuedValue, 0);

  return (
    <Card className="mt-4 overflow-x-auto tabular-nums">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Share class</TableHead>
            <TableHead>Authorized</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>Ownership</TableHead>
            <TableHead className="text-right">Issued value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.shareClassId}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell>{formatCompact(r.authorized)}</TableCell>
              <TableCell>{formatCount(r.shares)}</TableCell>
              <TableCell>{formatPercent(r.pct)}</TableCell>
              <TableCell className="text-right">
                {formatMoney(r.issuedValue)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>Total</TableCell>
            <TableCell>{formatCount(totalShares)}</TableCell>
            <TableCell />
            <TableCell className="text-right">
              {formatMoney(totalValue)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </Card>
  );
};
