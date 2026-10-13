import SignInForm from "@/components/onboarding/signin";
import { TenantLogin } from "@/components/onboarding/tenant-login";
import { IS_GOOGLE_AUTH_ENABLED } from "@/constants/auth";
import { constants } from "@/lib/constants";
import { getServerComponentAuthSession } from "@/server/auth";
import { domainConfig, tenantOrigin } from "@/server/domains/config";
import { getTenantLoginView } from "@/server/domains/login-view";
import { getRequestHost } from "@/server/domains/request-host";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Login",
  description: `Log in to ${constants.title}`,
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const host = await getRequestHost();
  const { enabled, baseDomain, scheme, port, canonicalOrigin } = domainConfig();

  if (host.kind === "unknown") {
    return redirect(`${canonicalOrigin}/domain-not-found`);
  }
  if (host.kind === "alias") {
    // x-dr-path is set by the proxy (pathname + search), never taken from the client
    const path = (await headers()).get("x-dr-path") ?? "/login";
    return redirect(`${tenantOrigin(host.redirectHost)}${path}`);
  }

  // on a tenant host this is the tenant-cookie session for this company only
  const session = await getServerComponentAuthSession();

  if (host.kind === "tenant") {
    if (session?.user) return redirect(`/${host.publicId}`);
    const callbackUrl = (await searchParams).callbackUrl;
    const view = await getTenantLoginView({
      companyId: host.companyId,
      hostname: host.hostname,
      next: typeof callbackUrl === "string" ? callbackUrl : null,
    });
    return <TenantLogin {...view} />;
  }

  if (session?.user) {
    if (session?.user?.companyPublicId) {
      return redirect(`/${session.user.companyPublicId}`);
    }
    return redirect("/onboarding");
  }

  return (
    <SignInForm
      isGoogleAuthEnabled={IS_GOOGLE_AUTH_ENABLED}
      companyAddress={enabled ? { baseDomain, scheme, port } : undefined}
    />
  );
}
