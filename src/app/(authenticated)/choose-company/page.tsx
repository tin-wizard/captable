import { CompanyChooser } from "@/components/onboarding/company-chooser";
import { withServerComponentSession } from "@/server/auth";
import { getCompanyList } from "@/server/company";
import { getRequestHost } from "@/server/domains/request-host";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Choose a company",
};

export default async function ChooseCompanyPage() {
  // the proxy already sends company hosts to canonical; this is the backstop
  if ((await getRequestHost()).kind !== "canonical") notFound();
  const session = await withServerComponentSession();
  const list = await getCompanyList(session.user.id);
  if (list.length === 0) redirect("/");

  return (
    <CompanyChooser
      companies={list.map((m) => ({
        id: m.company.id,
        memberId: m.id,
        name: m.company.name,
        url: m.url,
        // highlight only; the list itself comes from the DB
        current: m.company.publicId === session.user.companyPublicId,
      }))}
    />
  );
}
