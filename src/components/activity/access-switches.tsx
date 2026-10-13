"use client";

import { Switch } from "@/components/ui/switch";
import { api } from "@/trpc/react";
import { useState } from "react";
import { toast } from "sonner";

type Props = {
  kind: "DATA_ROOM" | "UPDATE";
  targetId: string;
  initialAllowDownload?: boolean;
  initialRequireNda: boolean;
  canEdit?: boolean;
};

// Downloads (data rooms only) and the NDA gate, next to the reminder switch.
export const AccessSwitches = ({
  kind,
  targetId,
  initialAllowDownload = false,
  initialRequireNda,
  canEdit = true,
}: Props) => {
  const [allowDownload, setAllowDownload] = useState(initialAllowDownload);
  const [requireNda, setRequireNda] = useState(initialRequireNda);

  const onError = () => toast.error("Could not change access settings");
  const room = api.dataRoom.setAccess.useMutation();
  const update = api.update.setAccess.useMutation();
  const pending = room.isLoading || update.isLoading;

  const toggleDownload = (checked: boolean) => {
    setAllowDownload(checked);
    room.mutate(
      { dataRoomId: targetId, allowDownload: checked },
      {
        onError: () => {
          setAllowDownload(!checked);
          onError();
        },
      },
    );
  };
  const toggleNda = (checked: boolean) => {
    setRequireNda(checked);
    const options = {
      onError: () => {
        setRequireNda(!checked);
        onError();
      },
    };
    if (kind === "DATA_ROOM")
      room.mutate({ dataRoomId: targetId, requireNda: checked }, options);
    else update.mutate({ updateId: targetId, requireNda: checked }, options);
  };

  return (
    <>
      {kind === "DATA_ROOM" && (
        <div className="flex items-start gap-x-2">
          <Switch
            id={`allow-download-${targetId}`}
            checked={allowDownload}
            disabled={!canEdit || pending}
            onCheckedChange={toggleDownload}
          />
          <div>
            <label
              htmlFor={`allow-download-${targetId}`}
              className="text-sm font-medium"
            >
              Allow downloads
            </label>
            <p className="text-xs text-muted-foreground">
              Adds a tracked Download button. Viewers can still save what they
              can see; this is not copy protection.
            </p>
          </div>
        </div>
      )}
      <div className="flex items-center gap-x-2">
        <Switch
          id={`require-nda-${targetId}`}
          checked={requireNda}
          disabled={!canEdit || pending}
          onCheckedChange={toggleNda}
        />
        <label
          htmlFor={`require-nda-${targetId}`}
          className="text-sm font-medium"
        >
          Require NDA
        </label>
      </div>
    </>
  );
};
