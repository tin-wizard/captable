"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

// Asks the tracked route for a short-lived attachment URL, then follows it.
export const DownloadButton = ({
  token,
  bucketId,
}: {
  token: string;
  bucketId: string;
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/activity/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, bucketId }),
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? "Downloading is not available for this file."
            : res.status === 404
              ? "This link is no longer valid."
              : "Download failed. Please try again.",
        );
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.location.assign(url);
    } catch {
      setError("Download failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={download} disabled={busy}>
        Download
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
};
