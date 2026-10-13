import { resolveRecipient } from "@/server/activity/resolve-recipient";
import type { Metadata } from "next";
import { UnsubscribeButton } from "./unsubscribe-button";

export const metadata: Metadata = {
  title: "Reminders",
  robots: { index: false },
};

const UnsubscribedPage = async (props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const kind = one(sp.kind);
  const token = one(sp.token);
  const valid =
    (kind === "DATA_ROOM" || kind === "UPDATE") &&
    !!token &&
    token.length <= 4096 &&
    !!(await resolveRecipient(kind, token));

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      {valid && token && (kind === "DATA_ROOM" || kind === "UPDATE") ? (
        <>
          <h1 className="text-xl font-semibold">Automatic reminders</h1>
          <p className="text-sm text-muted-foreground">
            Stop the automatic reminder emails about this{" "}
            {kind === "DATA_ROOM" ? "data room" : "update"}. You can still open
            it any time from the original email.
          </p>
          <UnsubscribeButton kind={kind} token={token} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This link is no longer valid.
        </p>
      )}
    </div>
  );
};

export default UnsubscribedPage;
