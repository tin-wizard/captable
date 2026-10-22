"use client";

import { NavLink } from "@/components/dashboard/sidebar/nav-link";
import { userLevelHref } from "@/server/domains/redirects";
import {
  RiAccountCircleFill,
  RiAccountCircleLine,
  RiBankCardFill,
  RiBankCardLine,
  RiBankFill,
  RiBankLine,
  RiBuildingFill,
  RiBuildingLine,
  RiGroup2Fill,
  RiGroup2Line,
  RiLock2Fill,
  RiLock2Line,
  RiNotificationFill,
  RiNotificationLine,
  RiShieldUserFill,
  RiShieldUserLine,
  RiTerminalBoxFill,
  RiTerminalBoxLine,
} from "@remixicon/react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

const companyNav = [
  {
    name: "Company",
    href: "/settings/company",
    icon: RiBuildingLine,
    activeIcon: RiBuildingFill,
  },
  {
    name: "Team",
    href: "/settings/team",
    icon: RiGroup2Line,
    activeIcon: RiGroup2Fill,
  },
  {
    name: "Roles",
    href: "/settings/roles",
    icon: RiShieldUserLine,
    activeIcon: RiShieldUserFill,
  },

  {
    name: "Billing",
    href: "/settings/billing",
    icon: RiBankCardLine,
    activeIcon: RiBankCardFill,
  },

  {
    name: "Bank Accounts",
    href: "/settings/bank-accounts",
    icon: RiBankLine,
    activeIcon: RiBankFill,
  },
];

const accountNav = [
  {
    name: "Profile",
    href: "/settings/profile",
    userLevel: "profile" as const,
    icon: RiAccountCircleLine,
    activeIcon: RiAccountCircleFill,
  },
  {
    name: "Security",
    href: "/settings/security",
    userLevel: "security" as const,
    icon: RiLock2Line,
    activeIcon: RiLock2Fill,
  },

  {
    name: "Developer",
    href: "/settings/developer",
    icon: RiTerminalBoxLine,
    activeIcon: RiTerminalBoxFill,
  },

  {
    name: "Notifications",
    href: "/settings/notifications",
    icon: RiNotificationLine,
    activeIcon: RiNotificationFill,
  },
];

interface SettingsSidebarProps {
  isBillingEnabled: boolean;
  /** set only on a company host */
  canonicalOrigin: string | null;
}

export function SettingsSidebar({
  isBillingEnabled,
  canonicalOrigin,
}: SettingsSidebarProps) {
  const currentPath = usePathname();
  const { data } = useSession();
  const companyPublicId = data?.user.companyPublicId;

  return (
    <ul className="text-sm">
      {companyNav.map((item) => {
        const href = `/${companyPublicId}${item.href}`;
        const isActive = currentPath === href;

        if (item.name === "Billing" && !isBillingEnabled) {
          return null;
        }

        return (
          <li key={item.name} className="rounded py-1">
            <NavLink
              active={isActive}
              name={item.name}
              href={href}
              icon={isActive ? item.activeIcon : item.icon}
            />
          </li>
        );
      })}

      <div className="mt-3 text-xs font-semibold leading-6 text-muted-foreground">
        Account
      </div>

      {accountNav.map((item) => {
        // absolute only on a company host, where these pages are never the active one
        const href = item.userLevel
          ? userLevelHref(canonicalOrigin, `${companyPublicId}`, item.userLevel)
          : `/${companyPublicId}${item.href}`;
        const isActive = currentPath.includes(href) || currentPath === href;

        return (
          <li key={item.name} className="rounded py-1">
            <NavLink
              active={isActive}
              name={item.name}
              href={href}
              icon={isActive ? item.activeIcon : item.icon}
            />
          </li>
        );
      })}
    </ul>
  );
}
