import SignInForm from "@/components/onboarding/signin";
import { IS_GOOGLE_AUTH_ENABLED } from "@/constants/auth";
import { constants } from "@/lib/constants";
import { getServerComponentAuthSession } from "@/server/auth";
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

  return <SignInForm isGoogleAuthEnabled={IS_GOOGLE_AUTH_ENABLED} />;
}
