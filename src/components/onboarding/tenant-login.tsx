import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { AuthShell } from "./auth-shell";

// Login page on a company host. Sign-in itself happens on the canonical host
// (the handoff); "Continue" starts it and brings the user back to `next`.
export function TenantLogin({
  title,
  subtitle,
  logo,
  continueHref,
  canonicalLoginHref,
}: {
  title: string;
  subtitle: string;
  logo: string | null;
  continueHref: string;
  canonicalLoginHref: string;
}) {
  return (
    <AuthShell>
      <div className="flex flex-col items-center gap-y-1 text-center">
        {logo && (
          <Avatar className="mb-4 h-14 w-14 rounded">
            <AvatarImage src={logo} alt="" />
          </Avatar>
        )}
        <h1 className="break-all text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {/* plain anchors: these are route handlers / another origin, not client routes */}
      <a href={continueHref} className={buttonVariants()}>
        Continue
      </a>
      <a
        href={canonicalLoginHref}
        className={buttonVariants({ variant: "link" })}
      >
        Use a different company
      </a>
    </AuthShell>
  );
}
