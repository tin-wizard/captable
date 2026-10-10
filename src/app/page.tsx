import { getServerComponentAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { companyHomeUrl } from "@/server/domains/links";
import { getRequestHost } from "@/server/domains/request-host";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await getServerComponentAuthSession();
  const host = await getRequestHost();

  if (session && host.kind === "tenant") {
    return redirect(`/${host.publicId}`);
  }

  if (session?.user?.companyPublicId) {
    return redirect(
      await companyHomeUrl(
        db,
        session.user.companyId,
        session.user.companyPublicId,
      ),
    );
  }

  return redirect("/login");
}
