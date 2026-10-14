"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/trpc/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  aRecordNote,
  canMakePrimary,
  cnameRecord,
  domainStatusLabel,
  makePrimaryDialogCopy,
  removeDialogCopy,
  txtRecord,
  verifiedCopy,
} from "./custom-domains-copy";

const ADD_ERRORS: Record<string, string> = {
  empty: "Enter a domain like investors.example.com",
  format: "Enter a domain like investors.example.com",
  platform: "That address belongs to Deal Room",
  taken: "That domain is already connected to another company",
  limit: "You can connect up to 5 domains",
};

const ACTION_ERRORS: Record<string, string> = {
  "not-found": "That domain no longer exists. Refresh and try again.",
  "not-verified": "Verify this domain before making it primary.",
  "last-address": "You can't remove your last address.",
  taken: "That domain is already connected to another company",
  "custom-primary":
    "Your company address is a custom domain. Use Make primary on the default address first.",
};

const CORS_NOTE =
  "Uploads from this address need the Cloudflare CORS entry to be added. Until it is, file uploads may fail here.";

const CopyRow = ({
  label,
  name,
  value,
}: { label: string; name: string; value: string }) => {
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Could not copy. Select the text instead.");
    }
  };
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Name</span>
        <code className="break-all rounded bg-muted px-1.5 py-0.5">{name}</code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Copy ${label} name`}
          onClick={() => copy(name, "Name")}
        >
          Copy
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Value</span>
        <code className="break-all rounded bg-muted px-1.5 py-0.5">
          {value}
        </code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Copy ${label} value`}
          onClick={() => copy(value, "Value")}
        >
          Copy
        </Button>
      </div>
    </div>
  );
};

export const CustomDomains = () => {
  const utils = api.useUtils();
  const current = api.domain.current.useQuery();
  const enabled = current.data?.enabled === true;
  const list = api.domain.custom.list.useQuery(undefined, { enabled });

  const [hostname, setHostname] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [missing, setMissing] = useState<
    Record<string, { owned: boolean; routed: boolean }>
  >({});
  const [confirm, setConfirm] = useState<{
    kind: "remove" | "primary";
    id: string;
  } | null>(null);
  const [corsUnsynced, setCorsUnsynced] = useState(false);

  const refresh = () =>
    Promise.all([
      utils.domain.custom.list.invalidate(),
      utils.domain.current.invalidate(),
    ]);
  const fail = (e: { message: string }) =>
    toast.error(ACTION_ERRORS[e.message] ?? "Something went wrong.");
  const noteCors = (corsSynced: boolean) => {
    if (!corsSynced) setCorsUnsynced(true);
  };

  const add = api.domain.custom.add.useMutation({
    onSuccess: async () => {
      setHostname("");
      setAddError(null);
      await refresh();
    },
    onError: (e) =>
      setAddError(ADD_ERRORS[e.message] ?? "Could not add that domain."),
  });
  const verify = api.domain.custom.verify.useMutation({
    onSuccess: async (r, { domainId }) => {
      if (r.ok) {
        setMissing(({ [domainId]: _, ...rest }) => rest);
        noteCors(r.corsSynced);
        const rows = utils.domain.custom.list.getData()?.rows ?? [];
        toast.success(
          verifiedCopy(
            rows.find((x) => x.id === domainId)?.hostname ?? "The domain",
            rows.find((x) => x.kind === "PLATFORM" && x.aliasExpiresAt === null)
              ?.hostname,
          ),
        );
        await refresh();
      } else {
        setMissing((m) => ({
          ...m,
          [domainId]: { owned: r.owned, routed: r.routed },
        }));
      }
    },
    onError: fail,
  });
  const setPrimary = api.domain.custom.setPrimary.useMutation({
    onSuccess: async ({ corsSynced }) => {
      noteCors(corsSynced);
      setConfirm(null);
      toast.success("Primary address changed");
      await refresh();
    },
    onError: (e) => {
      setConfirm(null);
      fail(e);
    },
  });
  const remove = api.domain.custom.remove.useMutation({
    onSuccess: async ({ corsSynced }) => {
      noteCors(corsSynced);
      setConfirm(null);
      await refresh();
    },
    onError: (e) => {
      setConfirm(null);
      fail(e);
    },
  });

  if (!enabled || !list.data) return null;

  const { rows, dnsTarget, serverIps } = list.data;
  const primary = rows.find((r) => r.isPrimary)?.hostname;
  const platformHost = rows.find(
    (r) => r.kind === "PLATFORM" && canMakePrimary({ ...r, isPrimary: false }),
  )?.hostname;
  const target = rows.find((r) => r.id === confirm?.id);
  const busy =
    add.isPending ||
    verify.isPending ||
    setPrimary.isPending ||
    remove.isPending;

  return (
    <div className="mt-10 max-w-xl space-y-4 border-t pt-8">
      <div>
        <h3 className="font-medium">Custom domains</h3>
        <p className="text-sm text-muted-foreground">
          Serve your data room from your own domain, like investors.example.com.
        </p>
      </div>

      <ul className="space-y-3">
        {rows.map((r) => {
          const label = domainStatusLabel(r);
          const m = missing[r.id];
          return (
            <li key={r.id} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium">{r.hostname}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
                {r.status !== "PENDING" && (
                  <div className="flex gap-2">
                    {canMakePrimary(r) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label={`Make ${r.hostname} primary`}
                        onClick={() =>
                          setConfirm({ kind: "primary", id: r.id })
                        }
                      >
                        Make primary
                      </Button>
                    )}
                    {r.kind === "CUSTOM" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label={`Remove ${r.hostname}`}
                        onClick={() => setConfirm({ kind: "remove", id: r.id })}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {r.status === "PENDING" && r.verificationToken && (
                <div className="space-y-3 text-sm">
                  <p className="text-muted-foreground">
                    Add these DNS records at your domain provider, then verify.
                  </p>
                  <CopyRow
                    label="TXT record"
                    {...txtRecord(r.hostname, r.verificationToken)}
                  />
                  <CopyRow
                    label="CNAME record"
                    {...cnameRecord(r.hostname, dnsTarget)}
                  />
                  <p className="text-muted-foreground">
                    {aRecordNote(serverIps)}
                  </p>
                  {m && (
                    <div role="alert" className="text-destructive">
                      <p>Not verified yet.</p>
                      <ul className="list-disc pl-5">
                        <li>
                          Ownership: {m.owned ? "found" : "TXT record missing"}
                        </li>
                        <li>
                          Routing: {m.routed ? "found" : "CNAME record missing"}
                        </li>
                      </ul>
                      <p className="text-muted-foreground">
                        DNS changes can take a while to appear.
                      </p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      aria-label={`Verify ${r.hostname}`}
                      onClick={() => verify.mutate({ domainId: r.id })}
                    >
                      Verify
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={`Remove ${r.hostname}`}
                      onClick={() => setConfirm({ kind: "remove", id: r.id })}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          setAddError(null);
          add.mutate({ hostname: hostname.trim() });
        }}
      >
        <div className="flex items-center gap-2">
          <Input
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="investors.example.com"
            aria-label="Custom domain"
            aria-invalid={!!addError}
          />
          <Button type="submit" disabled={!hostname.trim() || busy}>
            Add domain
          </Button>
        </div>
        {addError && (
          <p role="alert" className="text-sm text-destructive">
            {addError}
          </p>
        )}
      </form>

      {corsUnsynced && (
        <p className="text-sm text-muted-foreground">{CORS_NOTE}</p>
      )}

      <AlertDialog
        open={!!confirm && !!target}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "primary"
                ? `Make ${target?.hostname} your address?`
                : `Remove ${target?.hostname}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {target &&
                (confirm?.kind === "primary"
                  ? makePrimaryDialogCopy(target.hostname, primary)
                  : removeDialogCopy(target, platformHost))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending || setPrimary.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!confirm) return;
                if (confirm.kind === "primary")
                  setPrimary.mutate({ domainId: confirm.id });
                else remove.mutate({ domainId: confirm.id });
              }}
            >
              {confirm?.kind === "primary" ? "Make primary" : "Remove domain"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
