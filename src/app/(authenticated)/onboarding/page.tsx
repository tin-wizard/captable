import { CompanyForm } from "@/components/onboarding/company-form";
import { constants } from "@/lib/constants";
import { withServerComponentSession } from "@/server/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Onboarding",
};

const OnboardingPage = async () => {
  const session = await withServerComponentSession();
  const user = session.user;

  if (user.isOnboarded) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen justify-center bg-gradient-to-br from-navy-50 via-white to-ember-50 px-5 pb-5 pt-20">
      <div className="border-rounded w-full max-w-2xl border bg-white p-10 shadow">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome to {constants.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            You are almost there. Please complete the form below to continue
          </p>
        </div>
        <CompanyForm type="onboarding" />
      </div>
    </div>
  );
};

export default OnboardingPage;
