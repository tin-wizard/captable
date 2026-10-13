import { esignParams } from "@/components/analytics";
import { EsignAnalytics } from "@/components/analytics/esign/esign-analytics";
import EmptyState from "@/components/common/empty-state";
import { PageLayout } from "@/components/dashboard/page-layout";
import { UnAuthorizedState } from "@/components/ui/un-authorized-state";
import { serverAccessControl } from "@/lib/rbac/access-control";
import { withServerComponentSession } from "@/server/auth";
import { api } from "@/trpc/server";
import { RiUploadCloudLine } from "@remixicon/react";
import type { Metadata } from "next";
import { AddEsignDocumentButton } from "./components/add-esign-doc-button";

export const metadata: Metadata = {
  title: "Documents",
};

const EsignDocumentPage = async (props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const filters = esignParams(await props.searchParams);
  const { allow } = await serverAccessControl();
  if (!allow(true, ["templates", "read"])) {
    return <UnAuthorizedState />;
  }
  const session = await withServerComponentSession();
  const { documents } = await api.template.all.query();
  const analytics = await api.analytics.esign.query(filters);

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={<RiUploadCloudLine />}
        title="You do not have any documents!"
        subtitle="Click the button below to upload a new document for electronic signature."
      >
        <AddEsignDocumentButton
          title="esign a Document"
          subtitle=""
          companyPublicId={session.user.companyPublicId}
        />
      </EmptyState>
    );
  }

  return (
    <PageLayout
      title="eSign documents"
      description="Upload, sign and send documents for electronic signatures."
      action={
        <AddEsignDocumentButton
          title="esign a Document"
          subtitle=""
          companyPublicId={session.user.companyPublicId}
        />
      }
    >
      <div className="mt-3">
        <EsignAnalytics
          data={analytics}
          filters={filters}
          companyPublicId={session.user.companyPublicId}
        />
      </div>
    </PageLayout>
  );
};

export default EsignDocumentPage;
