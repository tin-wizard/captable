import { type RawSearchParams, captableParams } from "@/components/analytics";
import { CapTableView } from "@/components/captable/captable-view";
import { UnAuthorizedState } from "@/components/ui/un-authorized-state";
import { serverAccessControl } from "@/lib/rbac/access-control";
import { api } from "@/trpc/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cap table",
};

const CaptablePage = async (props: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<RawSearchParams>;
}) => {
  const { publicId } = await props.params;
  const { allow } = await serverAccessControl();
  if (!allow(true, ["securities", "read"])) {
    return <UnAuthorizedState />;
  }

  const { cursor, ...filters } = captableParams(await props.searchParams);
  const [data, top] = await Promise.all([
    api.captable.table.query({ ...filters, cursor, limit: 50 }),
    api.captable.table.query({ limit: 10 }),
  ]);

  return (
    <div className="flex flex-col gap-y-3">
      <div>
        <h3 className="font-medium">Cap table</h3>
        <p className="text-sm text-muted-foreground">
          Who owns what, across share classes, options and convertibles.
        </p>
      </div>
      <CapTableView
        publicId={publicId}
        data={data}
        top={top.rows}
        filters={filters}
        hasCursor={Boolean(cursor)}
      />
    </div>
  );
};

export default CaptablePage;
