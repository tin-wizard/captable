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
    onSuccess: async () => {
      toast.success("Reminder sent");
      await utils.activity.unopened.invalidate();
    },
  };
  const nudgeDataRoom = api.dataRoom.nudge.useMutation(options);
  const nudgeUpdate = api.update.nudge.useMutation(options);
  const pending = nudgeDataRoom.isLoading || nudgeUpdate.isLoading;

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
              <TableCell>Waiting {dayjsExt().to(item.waitingSince)}</TableCell>
              <TableCell className="text-right">
                {canNudge && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!item.nudgeable || pending}
                    onClick={() =>
                      kind === "DATA_ROOM"
                        ? nudgeDataRoom.mutate({
                            dataRoomId: item.targetId,
                            recipientId: item.recipientId,
                          })
                        : nudgeUpdate.mutate({
                            updateId: item.targetId,
                            recipientId: item.recipientId,
                          })
                    }
                  >
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
