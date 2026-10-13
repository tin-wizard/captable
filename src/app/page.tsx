import { getServerComponentAuthSession } from "@/server/auth";
import { getCompanyList } from "@/server/company";
import { chooserDecision } from "@/server/company-chooser";
import { db } from "@/server/db";
import { domainConfig } from "@/server/domains/config";
import { companyEntryUrl } from "@/server/domains/links";
import { getRequestHost } from "@/server/domains/request-host";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await getServerComponentAuthSession();
  const host = await getRequestHost();

  if (session && host.kind === "tenant") {
    return redirect(`/${host.publicId}`);
  }

  if (session?.user && host.kind === "canonical") {
    // from the DB, not the session: the session's company may be stale
    const decision = chooserDecision(await getCompanyList(session.user.id));
    if (decision.kind === "single") return redirect(decision.url);
    // flag off: no chooser, today's fallback below
    if (decision.kind === "many" && domainConfig().enabled)
      return redirect("/choose-company");
  }

  if (session?.user?.companyPublicId) {
    return redirect(
      await companyEntryUrl(
        db,
        session.user.companyId,
        session.user.companyPublicId,
      ),
    );
  }

  return redirect("/login");
}
