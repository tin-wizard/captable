"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemStyle,
  SelectSeparator,
  SelectValue,
} from "@/components/ui/select";

import { cn } from "@/lib/utils";
import type { TGetCompanyList } from "@/server/company";
import { companySwitchUrl } from "@/server/domains/core/host";
import { api } from "@/trpc/react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { RiAddCircleLine, RiExpandUpDownLine } from "@remixicon/react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { companyInitials } from "./company-initials";

interface CompanySwitcherProps {
  companies: TGetCompanyList;
  publicId: string;
  /** set only on a company host */
  canonicalOrigin: string | null;
}

const createCompanyValue = "cap-co-create-company";

function CompanyAvatar({
  name,
  logo,
  className,
}: {
  name: string;
  logo?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-8 rounded", className)}>
      {logo && <AvatarImage src={logo} alt="" />}
      <AvatarFallback className="rounded bg-primary/10 text-xs font-semibold text-primary">
        {companyInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function CompanySwitcher({
  companies,
  publicId,
  canonicalOrigin,
}: CompanySwitcherProps) {
  const value = useState(() => publicId)[0];
  const { update } = useSession();

  const pathname = usePathname();

  const switchCompany = api.company.switchCompany.useMutation();
  const current = companies.find((item) => item.company.publicId === publicId);
  const currentName = current?.company.name;

  return (
    <Select
      value={value}
      onValueChange={async (newValue) => {
        if (newValue === createCompanyValue) {
          window.location.assign(`${canonicalOrigin ?? ""}/company/new`);
          return;
        }

        if (newValue !== value) {
          const member = companies.find(
            (item) => item.company.publicId === newValue,
          );

          if (member) {
            // company host: switchCompany is denied there; the handoff's issue step updates lastAccessed
            if (!canonicalOrigin) {
              try {
                await switchCompany.mutateAsync({ id: member.id });
              } catch {
                // stale or foreign membership: reload to show current ones
                toast.error("That company is no longer available.");
                window.location.reload();
                return;
              }
              await update();
            }

            const routeSegments = pathname.split("/").filter(Boolean);
            const nonDynamicSegment = routeSegments.slice(1).join("/");

            window.location.assign(
              companySwitchUrl(
                member.url,
                canonicalOrigin,
                `/${nonDynamicSegment}`,
              ),
            );
          }
        }
      }}
    >
      <SelectPrimitive.Trigger
        title={currentName}
        className="group flex w-full items-center gap-x-3 rounded px-2 py-2 text-left transition-colors hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-secondary"
      >
        <CompanyAvatar name={currentName ?? ""} logo={current?.company.logo} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-serif text-[15px] font-medium leading-5 text-foreground">
            <SelectValue>{currentName}</SelectValue>
          </span>
          <span className="block text-xs leading-4 text-muted-foreground">
            Workspace
          </span>
        </span>
        <RiExpandUpDownLine
          className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground"
          aria-hidden
        />
      </SelectPrimitive.Trigger>
      <SelectContent>
        {companies.map((item) => (
          <SelectItem key={item.company.publicId} value={item.company.publicId}>
            <span className="flex items-center gap-x-2">
              <CompanyAvatar
                name={item.company.name}
                logo={item.company.logo}
                className="size-6 text-[10px]"
              />
              <span className="truncate">{item.company.name}</span>
            </span>
          </SelectItem>
        ))}

        <SelectSeparator />
        <SelectPrimitive.Item
          value={createCompanyValue}
          className={SelectItemStyle}
        >
          <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
            <RiAddCircleLine className="h-4 w-4" aria-hidden />
          </span>

          <SelectPrimitive.ItemText>Create Company</SelectPrimitive.ItemText>
        </SelectPrimitive.Item>
      </SelectContent>
    </Select>
  );
}
