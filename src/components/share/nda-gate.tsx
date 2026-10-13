"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

// Shown instead of the content until the recipient accepts; the page re-renders
// on the server after acceptance and only then mints file URLs.
export const NdaGate = ({
  kind,
  token,
  companyName,
  text,
}: {
  kind: "DATA_ROOM" | "UPDATE";
  token: string;
  companyName: string;
  text: string;
}) => {
  const router = useRouter();
  const id = useId();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  return (
    <form
      className="space-y-5"
      aria-labelledby={`${id}-title`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!checked) return;
        setBusy(true);
        setError(false);
        try {
          const res = await fetch("/api/activity/nda", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind, token }),
          });
          if (!res.ok) throw new Error(String(res.status));
          router.refresh();
        } catch {
          setError(true);
          setBusy(false);
        }
      }}
    >
      <h1 id={`${id}-title`} className="text-xl font-semibold">
        Confidentiality notice from {companyName}
      </h1>
      <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded border p-4 text-sm">
        {text}
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-accept`}
          required
          checked={checked}
          disabled={busy}
          onCheckedChange={(v) => setChecked(v === true)}
        />
        <Label htmlFor={`${id}-accept`}>
          I have read and accept this notice
        </Label>
      </div>
      <Button type="submit" disabled={!checked || busy}>
        {busy ? "Accepting..." : "Accept"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Could not record your acceptance. This link may no longer be valid.
        </p>
      )}
    </form>
  );
};
