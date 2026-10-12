"use client";

import { dayjsExt } from "@/common/dayjs";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/trpc/react";
import { useState } from "react";
import { toast } from "sonner";

type Props = {
  kind: "DATA_ROOM" | "UPDATE";
  targetPublicId: string;
  canNudge: boolean;
};

export const UnopenedList = ({ kind, targetPublicId, canNudge }: Props) => {
  const utils = api.useContext();
  const { data, error } = api.activity.unopened.useQuery({
    kind,
    targetPublicId,
  });

  const options = {
    onError: (e: { message: string }) => toast.error(e.message),
    onSettled: () => setSending(null),
    onSuccess: async () => {
      toast.success("Reminder sent");
      await utils.activity.unopened.invalidate();
    },
  };
  const nudgeDataRoom = api.dataRoom.nudge.useMutation(options);
  const nudgeUpdate = api.update.nudge.useMutation(options);
  // only the row being reminded is disabled
  const [sending, setSending] = useState<string | null>(null);

  // callers without audits:read (or any failure) see nothing
  if (error || !data?.items.length) return null;

  return (
    <div className="flex flex-col gap-y-2">
      <h3 className="text-sm font-medium">Not opened yet</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Recipient</TableHead>
            <TableHead scope="col">Waiting</TableHead>
            <TableHead scope="col" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((item) => (
            <TableRow key={`${item.targetId}-${item.recipientId}`}>
              <TableCell className="font-medium">
                {item.name || item.email}
              </TableCell>
              <TableCell>
                Waiting {dayjsExt().to(item.waitingSince, true)}
              </TableCell>
              <TableCell className="text-right">
                {canNudge && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!item.nudgeable || sending === item.recipientId}
                    onClick={() => {
                      setSending(item.recipientId);
                      if (kind === "DATA_ROOM")
                        nudgeDataRoom.mutate({
                          dataRoomId: item.targetId,
                          recipientId: item.recipientId,
                        });
                      else
                        nudgeUpdate.mutate({
                          updateId: item.targetId,
                          recipientId: item.recipientId,
                        });
                    }}
                  >
                    {/* a fresh nudge bumps updatedAt and removes the row, so this shows only on an old unopened row with lastNudgedAt set */}
                    {!item.nudgeable && item.lastNudgedAt
                      ? `Reminded ${dayjsExt().to(item.lastNudgedAt)}`
                      : "Send reminder"}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
