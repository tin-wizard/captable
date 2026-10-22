import type { ReactNode } from "react";
import { Table } from "../table";

interface DataTableContentProps {
  children: ReactNode;
}

export function DataTableContent({ children }: DataTableContentProps) {
  return (
    <div className="mt-6 rounded-lg border">
      <Table>{children}</Table>
    </div>
  );
}
