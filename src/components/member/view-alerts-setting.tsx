"use client";

import { Switch } from "@/components/ui/switch";
import { api } from "@/trpc/react";
import { toast } from "sonner";

export const ViewAlertsSetting = () => {
  const utils = api.useContext();
  const { data } = api.member.viewAlerts.useQuery();
  const set = api.member.setViewAlerts.useMutation({
    onSuccess: () => utils.member.viewAlerts.invalidate(),
    onError: () => toast.error("Could not save your preference"),
  });

  const { data: digest } = api.member.viewDigest.useQuery();
  const setDigest = api.member.setViewDigest.useMutation({
    onSuccess: () => utils.member.viewDigest.invalidate(),
    onError: () => toast.error("Could not save your preference"),
  });

  return (
    <>
      <div className="mt-6 flex items-center justify-between rounded border p-4">
        <div>
          <p className="font-medium">Activity alerts</p>
          <p className="text-sm text-muted-foreground">
            Email me when a recipient opens or returns to a shared data room,
            update or document.
          </p>
        </div>
        <Switch
          checked={data ?? true}
          disabled={data === undefined || set.isLoading}
          onCheckedChange={(enabled) => set.mutate({ enabled })}
        />
      </div>
      <div className="mt-3 flex items-center justify-between rounded border p-4">
        <div>
          <p className="font-medium">Daily summary</p>
          <p className="text-sm text-muted-foreground">
            Get one email a day instead of an email for every view.
          </p>
        </div>
        <Switch
          checked={digest ?? false}
          // The digest job only runs for members with activity alerts on.
          disabled={
            digest === undefined || data === false || setDigest.isLoading
          }
          onCheckedChange={(enabled) => setDigest.mutate({ enabled })}
        />
      </div>
    </>
  );
};
