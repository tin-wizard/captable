import { NavBar } from "@/components/dashboard/navbar";
import { SideBar } from "@/components/dashboard/sidebar";
import { ModalProvider } from "@/components/modals";
import { withServerComponentSession } from "@/server/auth";
import { getCompanyList } from "@/server/company";
import { domainConfig } from "@/server/domains/config";
import { isUserLevelPath, layoutRedirect } from "@/server/domains/redirects";
import { primaryHostnameForPublicId } from "@/server/domains/registry";
import { getRequestHost } from "@/server/domains/request-host";
import { isActiveMember } from "@/server/member";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import "@/styles/hint.css";
import { RBAC } from "@/lib/rbac";
import { getServerPermissions } from "@/lib/rbac/access-control";
import { RolesProvider } from "@/providers/roles-provider";

type DashboardLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ publicId: string }>;
};

const DashboardLayout = async (props: DashboardLayoutProps) => {
  const params = await props.params;

  const { publicId } = params;

  const { children } = props;

  const { enabled, canonicalOrigin: canonical } = domainConfig();
  const path = (await headers()).get("x-dr-path") ?? `/${publicId}`;
  const route = await primaryHostnameForPublicId(publicId);
  if (!route) notFound();
  const host = await getRequestHost();

  // The route's company decides the host, never the session's current company.
  const decision = layoutRedirect({
    host,
    path,
    routePublicId: publicId,
    routeCompanyPrimaryHost: enabled ? route.hostname : null,
  });
  if (decision && "redirect" in decision) redirect(decision.redirect);
  if (decision) notFound();

  const { user } = await withServerComponentSession();

  // flag off keeps today's bounce; on, user-level pages serve any company the user belongs to
  if (enabled && host.kind === "canonical" && isUserLevelPath(path)) {
    if (!(await isActiveMember(user.id, route.companyId))) notFound();
  } else if (user.companyPublicId !== publicId) {
    // company host: the tenant session matches by construction (backstop)
    redirect(`/${user.companyPublicId}`);
  }

  const [companies, permissionsData] = await Promise.all([
    getCompanyList(user.id),
    getServerPermissions(),
  ]);

  // Set only on a company host, where switching and creation leave for other origins.
  const canonicalOrigin = host.kind === "tenant" ? canonical : null;

  const permissions = RBAC.normalizePermissionsMap(permissionsData.permissions);
  return (
    <RolesProvider data={{ permissions }}>
      <div className="flex min-h-screen bg-gray-50">
        <aside className="sticky top-0 hidden min-h-full w-64 flex-shrink-0 flex-col lg:flex lg:border-r">
          <SideBar
            companies={companies}
            publicId={publicId}
            canonicalOrigin={canonicalOrigin}
          />
        </aside>
        <div className="flex h-full flex-grow flex-col">
          <NavBar
            companies={companies}
            publicId={publicId}
            canonicalOrigin={canonicalOrigin}
          />
          <div className="mx-auto min-h-full w-full px-5 py-10 lg:px-8 2xl:max-w-screen-xl">
            {children}
          </div>
        </div>
      </div>
      <ModalProvider />
    </RolesProvider>
  );
};

export default DashboardLayout;
