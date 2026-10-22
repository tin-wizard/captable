import { cn } from "@/lib/utils";
import type { RiHome4Line } from "@remixicon/react";
import Link from "next/link";

type Icon = typeof RiHome4Line;

interface NavLinkProps {
  href?: string;
  icon?: Icon;
  name: string;
  active: boolean;
  className?: string;
}

export function NavLink({ active, href, icon, name, className }: NavLinkProps) {
  const Icon = icon;

  return (
    <>
      {href ? (
        <Link
          href={href}
          className={cn(
            className,
            active
              ? "bg-secondary font-semibold text-foreground"
              : "text-foreground/80 hover:bg-secondary hover:text-foreground",
            "group flex gap-x-2.5 rounded px-2.5 py-1.5 text-[13.5px] leading-5",
          )}
        >
          {Icon && (
            <Icon
              className={cn(
                active
                  ? "text-primary"
                  : "text-muted-foreground group-hover:text-foreground",
                "h-4 w-4 shrink-0",
              )}
              aria-hidden="true"
            />
          )}
          {name}
        </Link>
      ) : (
        // biome-ignore lint/a11y/useButtonType: pre-existing, design-only change
        <button
          className={cn(
            className,
            active
              ? "bg-secondary font-semibold text-foreground"
              : "text-foreground/80 hover:bg-secondary hover:text-foreground",
            "group flex gap-x-2.5 rounded px-2.5 py-2.5 text-[13.5px] leading-5",
          )}
        >
          {Icon && (
            <Icon
              className={cn(
                active
                  ? "text-primary"
                  : "text-muted-foreground group-hover:text-foreground",
                "h-4 w-4 shrink-0",
              )}
              aria-hidden="true"
            />
          )}
          {name}
        </button>
      )}
    </>
  );
}
