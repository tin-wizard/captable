"use client";

import { Switch } from "@/components/ui/switch";
import { api } from "@/trpc/react";
import { useState } from "react";
import { toast } from "sonner";

type Props = {
  kind: "DATA_ROOM" | "UPDATE";
  targetId: string;
  initial: boolean;
  canEdit?: boolean;
};

export const AutoNudgeSwitch = ({
  kind,
  targetId,
  initial,
  canEdit = true,
}: Props) => {
  const { data } = api.company.preferences.useQuery();
  const [checked, setChecked] = useState(initial);
  const masterOn = data?.autoNudge === true;

  const options = {
    onError: () => {
      setChecked((c) => !c);
      toast.error("Could not change automatic reminders");
    },
  };
  const room = api.dataRoom.setAutoNudge.useMutation(options);
  const update = api.update.setAutoNudge.useMutation(options);
  const pending = room.isLoading || update.isLoading;

  const toggle = (enabled: boolean) => {
    setChecked(enabled);
    if (kind === "DATA_ROOM") room.mutate({ dataRoomId: targetId, enabled });
    else update.mutate({ updateId: targetId, enabled });
  };

  return (
    <div className="flex items-center gap-x-2">
      <Switch
        id={`auto-nudge-${targetId}`}
        checked={checked}
        disabled={!canEdit || !masterOn || pending}
        onCheckedChange={toggle}
      />
      <div>
        <label
          htmlFor={`auto-nudge-${targetId}`}
          className="text-sm font-medium"
        >
          Automatic reminders
        </label>
        {data && !masterOn && (
          <p className="text-xs text-muted-foreground">
            Turn on automatic reminders in Settings → Company first
          </p>
        )}
      </div>
    </div>
  );
};
