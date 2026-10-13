import SignInForm from "@/components/onboarding/signin";
import { IS_GOOGLE_AUTH_ENABLED } from "@/constants/auth";
import { constants } from "@/lib/constants";
import { getServerComponentAuthSession } from "@/server/auth";
import { domainConfig } from "@/server/domains/config";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Login",
  description: `Log in to ${constants.title}`,
};

export default async function SignIn() {
  const session = await getServerComponentAuthSession();

  if (session?.user) {
    if (session?.user?.companyPublicId) {
      return redirect(`/${session.user.companyPublicId}`);
    }
    return redirect("/onboarding");
  }

  const { enabled, baseDomain, scheme, port } = domainConfig();

  return (
    <SignInForm
      isGoogleAuthEnabled={IS_GOOGLE_AUTH_ENABLED}
      companyAddress={enabled ? { baseDomain, scheme, port } : undefined}
    />
  );
}
