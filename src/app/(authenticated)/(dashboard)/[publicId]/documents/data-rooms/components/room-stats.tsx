import { dayjsExt } from "@/common/dayjs";
import { formatDuration } from "@/components/activity/format";
import { Sparkline } from "@/components/analytics";
import type { DocumentsSummaryItem } from "@/server/analytics/document";

// The numbers under a room's name on the list: who looked, for how long, when,
// and how many recipients have not opened it yet.
export const RoomStats = ({ stats }: { stats: DocumentsSummaryItem }) => (
  <div className="flex items-center justify-between gap-3 border-t px-4 py-2 text-xs text-gray-500">
    <div className="min-w-0">
      <p className="truncate">
        <span className="font-medium text-gray-900">{stats.viewers}</span>{" "}
        viewer{stats.viewers === 1 ? "" : "s"} ·{" "}
        {formatDuration(stats.avgActiveSeconds)} avg ·{" "}
        {stats.lastViewedAt
          ? `last ${dayjsExt().to(stats.lastViewedAt)}`
          : "no views yet"}
      </p>
      {stats.unopened > 0 && (
        <p className="mt-0.5 font-medium text-amber-700">
          {stats.unopened} not opened yet
        </p>
      )}
    </div>
    <Sparkline
      data={stats.spark.map((s) => ({ index: s.day, value: s.visits }))}
      label={`${stats.visits} visits in the last 30 days`}
    />
  </div>
);
