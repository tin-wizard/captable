"use client";

/* Usage:
  <EmptyState
    icon={<RiLandscapeFill />}
    title="This is title"
    subtitle="This is subtitle">
    <Button size="lg">Button</Button>
  </EmptyState>
*/

import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  title?: string;
  bordered?: boolean;
  subtitle: string | React.ReactNode;
  icon?: React.ReactElement<React.SVGProps<SVGSVGElement>>;
  children?: React.ReactNode;
  error?: boolean;
};

const EmptyState = ({
  icon,
  title,
  bordered = true,
  subtitle,
  children,
  error = false,
}: EmptyStateProps) => {
  return (
    <div role="alert" className="overflow-hidden">
      <div className="container mx-auto px-4">
        <div className={cn(bordered && "rounded-lg border", "bg-card px-6")}>
          <div className="mx-auto w-full max-w-md py-10 text-center">
            <div
              className={cn(
                "mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg",
                error ? "bg-rose-100" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "[&_svg]:h-5 [&_svg]:w-5",
                  error ? "text-rose-500" : "text-primary",
                )}
              >
                {icon}
              </span>
            </div>

            {title && (
              <h3 className="mb-2 text-base font-semibold tracking-tight">
                {title}
              </h3>
            )}
            <p className="mb-5 text-sm text-muted-foreground">{subtitle}</p>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmptyState;
