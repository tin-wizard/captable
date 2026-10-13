import { db } from "@/server/db";
import { domainConfig } from "./config";
import { safeNextPath } from "./core/host";

/** Company-host login page. Name and logo appear only when the company opted in. */
export async function getTenantLoginView(input: {
  companyId: string;
  hostname: string;
  next: string | null;
}) {
  const company = await db.company.findUnique({
    where: { id: input.companyId },
    select: { name: true, logo: true, showNameOnLogin: true },
  });
  const named = company?.showNameOnLogin === true;
  return {
    title: named ? company.name : input.hostname,
    subtitle: "Sign in to continue to this workspace.",
    logo: named ? company.logo ?? null : null,
    continueHref: `/auth/handoff/start?next=${encodeURIComponent(
      safeNextPath(input.next),
    )}`,
    canonicalLoginHref: `${domainConfig().canonicalOrigin}/login`,
  };
}
