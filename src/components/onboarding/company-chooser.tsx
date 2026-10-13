import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AuthShell } from "./auth-shell";

// Shown at "/" to a user with several companies. Plain anchors: each company
// lives on its own host, and /logout is a page on this one.
export function CompanyChooser({
  companies,
}: {
  companies: { id: string; name: string; url: string; current: boolean }[];
}) {
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
