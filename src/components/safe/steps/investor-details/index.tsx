"use client";

import { api } from "@/trpc/react";
import { InvestorDetailsForm } from "./form";
export { type TFormSchema } from "./form";

export function InvestorDetails() {
  // until the query resolves the form shows the empty list, as with no stakeholders
  const { data: stakeholders = [] } =
    api.stakeholder.getStakeholders.useQuery();
  return <InvestorDetailsForm stakeholders={stakeholders} />;
}
