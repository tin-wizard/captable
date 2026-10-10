import { getServerComponentAuthSession } from "@/server/auth";
import { tenantOrigin } from "@/server/domains/config";
import { getRequestHost } from "@/server/domains/request-host";
import { headers } from "next/headers";
import { permanentRedirect, redirect } from "next/navigation";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = (await headers()).get("x-dr-path") ?? "/";
  const host = await getRequestHost();
  // before the session check, so a logged-out alias visitor lands on the primary host
  if (host.kind === "alias") {
    permanentRedirect(`${tenantOrigin(host.redirectHost)}${path}`);
  }

  const session = await getServerComponentAuthSession();

  if (!session) {
    redirect(`/login?callbackUrl=${encodeURIComponent(path)}`);
  }
  return <>{children}</>;
}
