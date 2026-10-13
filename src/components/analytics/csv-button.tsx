"use client";

import { Button } from "@/components/ui/button";
import { RiDownloadLine, RiLoader4Line } from "@remixicon/react";
import { useState } from "react";
import { toast } from "sonner";

type Props = {
  onExport: () => Promise<{ filename: string; csv: string }>;
  label?: string;
  disabled?: boolean;
};

export const CsvButton = ({
  onExport,
  label = "Export CSV",
  disabled,
}: Props) => {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const { filename, csv } = await onExport();
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not export this table");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={run}
      disabled={disabled || busy}
      aria-busy={busy}
    >
      {busy ? (
        <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <RiDownloadLine className="mr-1.5 h-4 w-4" aria-hidden />
      )}
      {label}
    </Button>
  );
};
