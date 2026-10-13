"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/trpc/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const RETENTION = [
  { value: "6", label: "6 months" },
  { value: "12", label: "12 months" },
  { value: "24", label: "24 months (default)" },
  { value: "36", label: "36 months" },
  { value: "keep", label: "Keep until I delete it" },
] as const;

const toValue = (m: number | null) => (m === null ? "keep" : String(m));

export const PreferencesCard = () => {
  const utils = api.useContext();
  const { data } = api.company.preferences.useQuery();
  const [timezone, setTimezone] = useState("UTC");
  const [retention, setRetention] = useState("24");
  const [autoNudge, setAutoNudge] = useState(false);

  useEffect(() => {
    if (data) {
      setTimezone(data.timezone);
      setRetention(toValue(data.viewRetentionMonths));
      setAutoNudge(data.autoNudge);
    }
  }, [data]);

  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf("timeZone");
    // "UTC" is not in supportedValuesOf; keep the saved value selectable too
    return Array.from(new Set(["UTC", ...all, data?.timezone ?? "UTC"]));
  }, [data?.timezone]);

  const save = api.company.updatePreferences.useMutation({
    onSuccess: () => {
      toast.success("Preferences saved");
      return utils.company.preferences.invalidate();
    },
    onError: () => toast.error("Could not save preferences"),
  });

  return (
    <div className="mt-6 rounded border p-4">
      <p className="font-medium">Preferences</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-sm font-medium">Timezone</p>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {zones.map((z) => (
                <SelectItem key={z} value={z}>
                  {z}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium">View data retention</p>
          <Select value={retention} onValueChange={setRetention}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETENTION.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-sm text-muted-foreground">
            View events older than this are deleted daily. The audit log is not
            affected.
          </p>
          {data && (
            <p className="text-sm text-muted-foreground">
              {data.viewRetentionMonths === null
                ? "Currently keeping view data until you delete it"
                : `Currently deleting data older than ${data.viewRetentionMonths} months`}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 flex items-start gap-x-3">
        <Switch
          id="auto-nudge"
          checked={autoNudge}
          onCheckedChange={setAutoNudge}
          disabled={!data}
        />
        <div>
          <label htmlFor="auto-nudge" className="text-sm font-medium">
            Automatic reminders
          </label>
          <p className="text-sm text-muted-foreground">
            Remind recipients who have not opened a shared data room or update:
            once after 3 days and once after 7, only between 09:00 and 18:00 in
            your timezone. Turn it on per data room and update as well.
            Recipients can opt out.
          </p>
        </div>
      </div>
      <Button
        className="mt-4"
        disabled={!data || save.isLoading}
        onClick={() =>
          save.mutate({
            timezone,
            autoNudge,
            viewRetentionMonths:
              retention === "keep"
                ? null
                : (Number(retention) as 6 | 12 | 24 | 36),
          })
        }
      >
        Save
      </Button>
    </div>
  );
};
