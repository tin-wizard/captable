"use client";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { enterCompany } from "@/server/company-chooser";
import { api } from "@/trpc/react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { AuthShell } from "./auth-shell";

// Shown at "/" to a user with several companies. Host-bound companies are plain
// handoff links; one without a host is switched to first (enterCompany).
export function CompanyChooser({
  companies,
}: {
  companies: {
    id: string;
    memberId: string;
    name: string;
    url: string;
    current: boolean;
  }[];
}) {
  const { update } = useSession();
  const switchCompany = api.company.switchCompany.useMutation();

  return (
    <AuthShell>
      <div className="flex flex-col gap-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Choose a company
        </h1>
        <p className="text-sm text-muted-foreground">
          You belong to more than one company.
        </p>
      </div>
      <ul className="grid gap-2">
        {companies.map((c) => (
          <li key={c.id}>
            <a
              href={c.url}
              aria-current={c.current ? "true" : undefined}
              onClick={async (e) => {
                if (!c.url.startsWith("/")) return; // handoff link: plain navigation
                e.preventDefault();
                try {
                  await enterCompany(c, {
                    switchCompany: (id) => switchCompany.mutateAsync({ id }),
                    refreshSession: update,
                    assign: (url) => window.location.assign(url),
                  });
                } catch {
                  // stale or foreign membership: reload to show current ones
                  toast.error("That company is no longer available.");
                  window.location.reload();
                }
              }}
              className={cn(
                "flex items-center justify-between rounded-md border px-4 py-3 text-sm font-medium hover:bg-muted",
                c.current && "border-primary",
              )}
            >
              <span className="truncate">{c.name}</span>
              {c.current && (
                <span className="text-xs text-muted-foreground">Current</span>
              )}
            </a>
          </li>
        ))}
      </ul>
      <div className="flex justify-between">
        <a href="/company/new" className={buttonVariants({ variant: "link" })}>
          Create a company
        </a>
        <a href="/logout" className={buttonVariants({ variant: "link" })}>
          Log out
        </a>
      </div>
    </AuthShell>
  );
}
