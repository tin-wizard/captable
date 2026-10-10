import type { TGetCompanyList } from "@/server/company";
import { domainConfig } from "@/server/domains/config";
import { CommandMenu } from "./command-menu";
import { MobileDrawer } from "./mobile-drawer";
import { UserDropdown } from "./user-dropdown";

interface SideBarProps {
  publicId: string;
  companies: TGetCompanyList;
  /** set only on a company host */
  canonicalOrigin: string | null;
}

export function NavBar({ publicId, companies, canonicalOrigin }: SideBarProps) {
  const { enabled, canonicalHost: host } = domainConfig();
  const canonicalHost = enabled ? host : null;
  return (
    <div className="sticky top-0 z-50 w-full border-b">
      <header className="flex h-14 items-center bg-gray-50 px-4 lg:px-8">
        <div className="flex w-full items-center justify-between">
          <MobileDrawer
            publicId={publicId}
            companies={companies}
            canonicalOrigin={canonicalOrigin}
          />
          <div className="flex items-center gap-6">
            <CommandMenu companyPublicId={publicId} />
            <UserDropdown
              companyPublicId={publicId}
              canonicalHost={canonicalHost}
            />
          </div>
        </div>
      </header>
    </div>
  );
}
