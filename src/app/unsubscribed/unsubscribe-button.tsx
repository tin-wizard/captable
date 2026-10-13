"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

// A button, not an automatic GET: mail scanners open links, and they must not
// opt people out.
export const UnsubscribeButton = ({
  kind,
  token,
}: {
  kind: "DATA_ROOM" | "UPDATE";
  token: string;
}) => {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">(
    "idle",
  );

  if (state === "done")
    return (
      <p role="status" className="text-sm font-medium">
        Done. You will not get automatic reminders about this anymore.
      </p>
    );

  return (
    <div className="space-y-2">
      <Button
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          try {
            const res = await fetch("/api/activity/unsubscribe", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ kind, token }),
            });
            setState(res.ok ? "done" : "error");
          } catch {
            setState("error");
          }
        }}
      >
        Stop these reminders
      </Button>
      {state === "error" && (
        <p role="alert" className="text-sm text-muted-foreground">
          This link is no longer valid.
        </p>
      )}
    </div>
  );
};
