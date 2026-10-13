"use client";

import { dayjsExt } from "@/common/dayjs";
import { formatHours } from "@/components/analytics";
import { Card } from "@/components/ui/card";
import type { EnvelopeDetail } from "@/server/analytics/esign";
import { Tracker } from "@tremor/react";

// One block per signer (green signed, blue sent, grey not sent), then the
// table of who did what and when: the "waiting on X for N days" view.
export const SignerProgress = ({ detail }: { detail: EnvelopeDetail }) => {
  const signed = detail.signers.filter((s) => s.signedAt).length;
  const waiting = detail.signers
    .filter((s) => s.waitingDays !== null)
    .sort((a, b) => (b.waitingDays ?? 0) - (a.waitingDays ?? 0));

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Signing progress</h3>
        <p className="text-xs text-muted-foreground">
          {signed} of {detail.signers.length} signed
        </p>
      </div>
      <Tracker
        className="mt-3 h-8"
        data={detail.signers.map((s) => ({
          color: s.signedAt ? "emerald" : s.sentAt ? "blue" : "gray",
          tooltip: `${s.name || s.email}: ${
            s.signedAt ? "signed" : s.sentAt ? "waiting" : "not sent"
          }`,
        }))}
      />
      {waiting[0] && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Waiting on {waiting[0].name || waiting[0].email} for{" "}
          {waiting[0].waitingDays} days
          {waiting.length > 1 && ` (and ${waiting.length - 1} more)`}.
        </p>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="py-1 pr-3 font-medium">
                Signer
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Sent
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Opened
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Signed
              </th>
              <th scope="col" className="py-1 font-medium">
                Took
              </th>
            </tr>
          </thead>
          <tbody>
            {detail.signers.map((s) => (
              <tr key={s.recipientId} className="border-t">
                <td className="py-1.5 pr-3">
                  <span className="font-medium">{s.name || s.email}</span>
                  {s.name && (
                    <span className="block text-xs text-muted-foreground">
                      {s.email}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3">
                  {s.sentAt ? dayjsExt(s.sentAt).format("MMM D, HH:mm") : "—"}
                </td>
                <td className="py-1.5 pr-3">
                  {s.viewedAt
                    ? dayjsExt(s.viewedAt).format("MMM D, HH:mm")
                    : "—"}
                </td>
                <td className="py-1.5 pr-3">
                  {s.signedAt
                    ? dayjsExt(s.signedAt).format("MMM D, HH:mm")
                    : "—"}
                </td>
                <td className="py-1.5">{formatHours(s.hoursToSign)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
