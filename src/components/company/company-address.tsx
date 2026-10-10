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
import { useDebounceValue } from "usehooks-ts";

const REASONS = {
  format: "Use 3-40 lowercase letters, numbers or hyphens.",
  reserved: "That name is reserved.",
  taken: "That address is already taken.",
} as const;

export const CompanyAddress = () => {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced] = useDebounceValue(value.trim(), 400);

  const current = api.domain.current.useQuery();
  const check = api.domain.checkRename.useQuery(
    { label: debounced },
    { enabled: !!debounced },
  );
  const rename = api.domain.rename.useMutation({
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e) => {
      setOpen(false);
      let msg = "Could not change the address.";
      try {
        if (e.data?.code === "CONFLICT") {
          const { suggestion } = JSON.parse(e.message);
          msg = `That address was just taken.${
            suggestion ? ` Try ${suggestion}.` : ""
          }`;
        } else if (e.data?.code === "BAD_REQUEST" && e.message in REASONS) {
          msg = REASONS[e.message as keyof typeof REASONS];
        }
      } catch {}
      toast.error(msg);
    },
  });

  if (!current.data?.enabled) return null;

  const settled =
    !!debounced && debounced === value.trim() && !check.isFetching;
  const available = settled && check.data?.available === true;
  const status = !value.trim()
    ? null
    : !settled
      ? "Checking..."
      : check.isError
        ? "Could not check the address."
        : available
          ? "Available"
          : `${REASONS[check.data?.reason ?? "taken"]}${
              check.data?.suggestion ? ` Try ${check.data.suggestion}.` : ""
            }`;

  return (
    <div className="mt-10 max-w-xl space-y-4 border-t pt-8">
      <div>
        <h3 className="font-medium">Company address</h3>
        <p className="text-sm text-muted-foreground">
          {current.data.hostname ?? "No address assigned yet."}
        </p>
      </div>

      {current.data.aliases.length > 0 && (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {current.data.aliases.map((a) => (
            <li key={a.hostname}>
              {a.hostname} (redirects until{" "}
              {new Date(a.expiresAt).toLocaleDateString()})
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value.toLowerCase())}
          placeholder="new-address"
          aria-label="New company address"
        />
        <Button
          type="button"
          disabled={!available || rename.isPending}
          onClick={() => setOpen(true)}
        >
          Change
        </Button>
      </div>
      {status && (
        <p
          className={`text-sm ${
            available ? "text-green-600" : "text-muted-foreground"
          }`}
          aria-live="polite"
        >
          {status}
        </p>
      )}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change company address?</AlertDialogTitle>
            <AlertDialogDescription>
              Old links keep working for 30 days. After that they stop working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                rename.mutate({ label: value.trim() });
              }}
            >
              Change address
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
