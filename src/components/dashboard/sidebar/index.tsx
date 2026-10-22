"use client";

import {
  RiEqualizer2Fill,
  RiEqualizer2Line,
  RiFolder5Fill,
  RiFolder5Line,
  RiFolderChart2Fill,
  RiFolderChart2Line,
  RiFolderChartFill,
  RiFolderChartLine,
  RiGroup2Fill,
  RiGroup2Line,
  RiHome2Fill,
  RiHome2Line,
  RiListCheck3,
  RiListIndefinite,
  RiMailSendFill,
  RiMailSendLine,
  RiMoneyDollarCircleFill,
  RiMoneyDollarCircleLine,
  RiPieChartFill,
  RiPieChartLine,
  RiPulseFill,
  RiPulseLine,
  RiSafeFill,
  RiSafeLine,
} from "@remixicon/react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import { usePathname } from "next/navigation";
import { Fragment } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { NavLink } from "./nav-link";

import type { TGetCompanyList } from "@/server/company";
import { CompanySwitcher } from "./company-switcher";

const navigation = [
  {
    name: "Overview",
    href: "/",
    icon: RiHome2Line,
    activeIcon: RiHome2Fill,
  },
  {
    name: "Cap table",
    href: "/captable",
    icon: RiPieChartLine,
    activeIcon: RiPieChartFill,
  },
  {
    name: "Stakeholders",
    href: "/stakeholders",
    icon: RiGroup2Line,
    activeIcon: RiGroup2Fill,
  },
  {
    name: "Share classes",
    href: "/share-classes",
    icon: RiFolderChart2Line,
    activeIcon: RiFolderChart2Fill,
  },
  {
    name: "Equity plans",
    href: "/equity-plans",
    icon: RiFolderChart2Line,
    activeIcon: RiFolderChart2Fill,
  },
  {
    name: "Securities",
    href: "/securities",
    icon: RiSafeLine,
    activeIcon: RiSafeFill,
    subNav: [
      {
        name: "Shares",
        href: "/shares",
      },
      {
        name: "Stock options",
        href: "/options",
      },
      {
        name: "Transactions",
        href: "/transactions",
      },
    ],
  },
  {
    name: "Fundraise",
    href: "/fundraise",
    icon: RiMoneyDollarCircleLine,
    activeIcon: RiMoneyDollarCircleFill,
    subNav: [
      {
        name: "SAFEs",
        href: "/safes",
      },

      {
        name: "Convertible notes",
        href: "/convertible-notes",
      },

      {
        name: "Investments",
        href: "/investments",
      },
    ],
  },

  {
    name: "Documents",
    href: "/documents",
    icon: RiFolder5Line,
    activeIcon: RiFolder5Fill,
    subNav: [
      {
        name: "Data rooms",
        href: "/data-rooms",
      },
      {
        name: "eSign documents",
        href: "/esign",
      },
      {
        name: "All documents",
        href: "/",
      },
      // {
      //   name: "Share documents",
      //   href: "/share",
      // },
    ],
  },

  {
    name: "Updates",
    href: "/updates",
    icon: RiMailSendLine,
    activeIcon: RiMailSendFill,
  },

  {
    name: "Reports",
    href: "/reports",
    icon: RiFolderChartLine,
    activeIcon: RiFolderChartFill,
  },

  {
    name: "Activity",
    href: "/activity",
    icon: RiPulseLine,
    activeIcon: RiPulseFill,
  },

  {
    name: "Audits",
    href: "/audits",
    icon: RiListIndefinite,
    activeIcon: RiListCheck3,
  },
];

const company = [
  {
    id: 1,
    name: "Team",
    rootPath: "/settings/team",
    href: "/settings/team",
    icon: RiGroup2Line,
    activeIcon: RiGroup2Fill,
  },
  {
    id: 2,
    name: "Settings",
    rootPath: "/settings/company",
    href: "/settings/company",
    icon: RiEqualizer2Line,
    activeIcon: RiEqualizer2Fill,
  },
  // Form 3921 (/3921) and 409A Valuation (/409a) are unbuilt stubs: add their
  // links back here when the pages exist.
];

// static group labels, rendered before the item with this name
const groupBefore: Record<string, string> = {
  Overview: "Equity",
  Fundraise: "Deals",
};

interface SideBarProps {
  className?: string;
  publicId: string;
  companies: TGetCompanyList;
  /** set only on a company host */
  canonicalOrigin: string | null;
}

export function SideBar({
  className,
  publicId,
  companies,
  canonicalOrigin,
}: SideBarProps) {
  const currentPath = usePathname();

  const basePath = `/${publicId}`;

  return (
    <ScrollArea className="h-screen px-3">
      <div className={cn("pb-12", className)}>
        <div className="fixed gap-y-4 py-4">
          {/* the column is fixed, so it can't inherit the 16rem sidebar's width */}
          <div className="w-[14.5rem] border-b border-border pb-3">
            <CompanySwitcher
              companies={companies}
              publicId={publicId}
              canonicalOrigin={canonicalOrigin}
            />
          </div>

          <div className="overflow-auto py-2">
            <ul className="space-y-0.5">
              {navigation.map((item) => {
                const href = basePath + item.href;
                const isActive =
                  currentPath === href ||
                  (currentPath === basePath && item.href === "/") ||
                  (currentPath.includes(`${item.href}/`) && item.href !== "/");

                const groupLabel = groupBefore[item.name];

                return (
                  <Fragment key={item.name}>
                    {groupLabel && (
                      <li
                        aria-hidden="true"
                        className="px-2.5 pb-1.5 pt-3.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground"
                      >
                        {groupLabel}
                      </li>
                    )}
                    <li>
                      {item.subNav ? (
                        <Accordion type="single" collapsible>
                          <AccordionItem value="item-1" className="border-none">
                            <div className="flex">
                              {isActive ? (
                                <item.activeIcon
                                  className={cn(
                                    "ml-2.5 mr-0 mt-2 inline-block",
                                    "text-primary",
                                    "h-4 w-4 shrink-0",
                                  )}
                                  aria-hidden="true"
                                />
                              ) : (
                                <item.icon
                                  className={cn(
                                    "ml-2.5 mr-0 mt-2 inline-block",
                                    "text-muted-foreground group-hover:text-foreground",
                                    "h-4 w-4 shrink-0",
                                  )}
                                  aria-hidden="true"
                                />
                              )}

                              <AccordionTrigger
                                className={cn(
                                  isActive
                                    ? "bg-secondary font-medium text-foreground"
                                    : "text-foreground/80 hover:bg-secondary hover:text-foreground",
                                  "group flex gap-x-2.5 rounded px-2.5 py-1.5 text-[14.5px] leading-5 hover:no-underline",
                                )}
                              >
                                {item.name}
                              </AccordionTrigger>
                            </div>

                            <AccordionContent>
                              <ul className="space-y-0.5">
                                {item.subNav.map((subItem) => {
                                  const href =
                                    basePath + item.href + subItem.href;
                                  const isActive =
                                    (subItem.href !== "/" &&
                                      currentPath.includes(
                                        item.href + subItem.href,
                                      )) ||
                                    href === `${currentPath}/`;

                                  return (
                                    <li key={subItem.name}>
                                      <NavLink
                                        active={isActive}
                                        name={subItem.name}
                                        href={href}
                                        className="ml-9"
                                      />
                                    </li>
                                  );
                                })}
                              </ul>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      ) : (
                        <NavLink
                          active={isActive}
                          name={item.name}
                          href={href}
                          icon={isActive ? item.activeIcon : item.icon}
                        />
                      )}
                    </li>
                  </Fragment>
                );
              })}
            </ul>

            <div className="py-3">
              <div
                aria-hidden="true"
                className="px-2.5 pb-1.5 pt-3.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground"
              >
                Company
              </div>
              <ul className="space-y-0.5">
                {company.map((item) => {
                  const href = basePath + item.href;
                  const isActive =
                    currentPath === href ||
                    (currentPath === basePath && item.href === "/") ||
                    (currentPath.includes(`/${item.href}/`) &&
                      item.href !== "/") ||
                    (currentPath.includes(`${item.rootPath}`) &&
                      item.href !== "/");

                  return (
                    <li key={item.name}>
                      <NavLink
                        active={isActive}
                        name={item.name}
                        href={`${basePath}${item.href}`}
                        icon={isActive ? item.activeIcon : item.icon}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
