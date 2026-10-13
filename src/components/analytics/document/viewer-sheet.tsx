"use client";

import { dayjsExt } from "@/common/dayjs";
import {
  countryName,
  formatDuration,
  topPages,
} from "@/components/activity/format";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api } from "@/trpc/react";
import { Tracker } from "@tremor/react";

type Props = {
  kind: "DATA_ROOM" | "UPDATE";
  targetPublicId: string;
  viewer: { recipientId: string; label: string; email: string } | null;
  onClose: () => void;
};

// One viewer's visits: a 30-day strip (one block a day) and the visit list.
export const ViewerSheet = ({
  kind,
  targetPublicId,
  viewer,
  onClose,
}: Props) => {
  const { data, isLoading, error } = api.analytics.viewerVisits.useQuery(
    { kind, targetPublicId, recipientId: viewer?.recipientId ?? "" },
    { enabled: !!viewer },
  );

  const days = Array.from({ length: 30 }, (_, i) => {
    const d = dayjsExt().subtract(29 - i, "day");
    const key = d.format("YYYY-MM-DD");
    const visits = (data?.items ?? []).filter(
      (v) => dayjsExt(v.createdAt).format("YYYY-MM-DD") === key,
    );
    const seconds = visits.reduce((n, v) => n + v.activeSeconds, 0);
    return {
      key,
      color: !visits.length ? "gray" : seconds >= 60 ? "emerald" : "blue",
      tooltip: `${d.format("MMM D")}: ${
        visits.length
          ? `${visits.length} visit${
              visits.length > 1 ? "s" : ""
            }, ${formatDuration(seconds)}`
          : "no visits"
      }`,
    };
  });

  return (
    <Sheet open={!!viewer} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{viewer?.label}</SheetTitle>
          <SheetDescription>{viewer?.email}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          <div>
            <h4 className="mb-2 text-xs font-medium text-muted-foreground">
              Last 30 days
            </h4>
            <Tracker
              data={days.map((d) => ({ color: d.color, tooltip: d.tooltip }))}
              className="h-8"
            />
            <p className="sr-only">
              {days.filter((d) => d.color !== "gray").length} days with visits
              in the last 30 days.
            </p>
          </div>
          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-muted-foreground">
              Visits could not be loaded.
            </p>
          )}
          {data && data.items.length === 0 && (
            <p className="text-sm text-muted-foreground">No visits recorded.</p>
          )}
          <ul className="space-y-3">
            {data?.items.map((v) => {
              const pages = topPages(v.pageSeconds, 3);
              return (
                <li key={v.id} className="rounded-md border p-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">
                      {dayjsExt(v.createdAt).format("MMM D, HH:mm")}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDuration(v.activeSeconds)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {[countryName(v.country), v.network]
                      .filter(Boolean)
                      .join(" · ") || "Location unknown"}
                  </div>
                  {pages.length > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {pages
                        .map(
                          (p) => `p.${p.page} · ${formatDuration(p.seconds)}`,
                        )
                        .join(", ")}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
};
