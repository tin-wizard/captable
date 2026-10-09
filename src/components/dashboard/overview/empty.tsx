import EmptyState from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { constants } from "@/lib/constants";
import { RiArrowRightLine, RiPieChartFill } from "@remixicon/react";
import Link from "next/link";

type EmptyOverviewProps = {
  firstName: string | undefined;
  publicCompanyId: string;
};

const EmptyOverview = ({ firstName, publicCompanyId }: EmptyOverviewProps) => {
  return (
    <EmptyState
      icon={<RiPieChartFill />}
      title={`Welcome to ${constants.title}${firstName && `, ${firstName}`} 👋`}
      subtitle={
        <span className="text-muted-foreground">
          We will get your cap table set up in no time.
        </span>
      }
    >
      <Button size="lg">
        <Link href={`/${publicCompanyId}/stakeholders`}>
          Let{`'`}s get started
          <RiArrowRightLine className="ml-5 inline-block h-4 w-5" />
        </Link>
      </Button>
    </EmptyState>
  );
};

export default EmptyOverview;
