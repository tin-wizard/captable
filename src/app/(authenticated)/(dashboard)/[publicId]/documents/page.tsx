import {
  RangeTabs,
  StatCard,
  analyticsParams,
  formatCompact,
  formatCount,
} from "@/components/analytics";
import EmptyState from "@/components/common/empty-state";
import { PageLayout } from "@/components/dashboard/page-layout";
import { Card } from "@/components/ui/card";
import { UnAuthorizedState } from "@/components/ui/un-authorized-state";
import { serverAccessControl } from "@/lib/rbac/access-control";
import { withServerComponentSession } from "@/server/auth";
import { api } from "@/trpc/server";
import { RiUploadCloudLine } from "@remixicon/react";
import type { Metadata } from "next";
import DocumentsTable from "./components/table";
import { DocumentUploadButton } from "./document-upload-button";

export const metadata: Metadata = {
  title: "Documents",
};

const DocumentsPage = async (props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const filters = analyticsParams(await props.searchParams);
  const { allow } = await serverAccessControl();
  const session = await withServerComponentSession();

  const documents = await allow(api.document.getAll.query(), [
    "documents",
    "read",
  ]);

  const canUpload = allow(true, ["documents", "read"]);

  if (!documents) {
    return <UnAuthorizedState />;
  }

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={<RiUploadCloudLine />}
        title="You do not have any documents!"
        subtitle="Please click the button below to upload a new document."
      >
        {canUpload && (
          <DocumentUploadButton
            companyPublicId={session.user.companyPublicId}
            buttonDisplayName="Upload a document"
          />
        )}
      </EmptyState>
    );
  }

  const canSeeActivity = allow(true, ["audits", "read"]);
  const rooms = canSeeActivity
    ? (
        await api.analytics.documentsSummary.query({
          kind: "DATA_ROOM",
          range: filters.range,
          from: filters.from,
          to: filters.to,
        })
      ).items
    : null;
  const views = rooms?.reduce((n, r) => n + r.visits, 0) ?? 0;
  const unopened = rooms?.reduce((n, r) => n + r.unopened, 0) ?? 0;
  const viewers = rooms?.reduce((n, r) => n + r.viewers, 0) ?? 0;

  return (
    <div className="flex flex-col gap-y-3">
      <PageLayout
        title="All documents"
        description="Upload documents to your company's document library."
        action={
          canUpload ? (
            <DocumentUploadButton
              companyPublicId={session.user.companyPublicId}
              buttonDisplayName="Document"
            />
          ) : null
        }
      />
      {rooms && (
        <section aria-label="Sharing activity" className="mt-3 space-y-3">
          <RangeTabs />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Documents" value={formatCount(documents.length)} />
            <StatCard
              label="Data room views"
              value={formatCompact(views)}
              href={`/${session.user.companyPublicId}/activity`}
            />
            <StatCard label="Viewers" value={formatCompact(viewers)} />
            <StatCard
              label="Not opened yet"
              value={formatCount(unopened)}
              upIsGood={false}
              href={`/${session.user.companyPublicId}/documents/data-rooms`}
            />
          </div>
        </section>
      )}
      <Card className="mt-3">
        <div className="p-6">
          <DocumentsTable
            companyPublicId={session.user.companyPublicId}
            documents={documents}
          />
        </div>
      </Card>
    </div>
  );
};

export default DocumentsPage;
