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

  return (
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
  );
};
