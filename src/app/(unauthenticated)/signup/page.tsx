import SignUpForm from "@/components/onboarding/signup";
import { IS_GOOGLE_AUTH_ENABLED } from "@/constants/auth";
import { constants } from "@/lib/constants";
import { getServerComponentAuthSession } from "@/server/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Sign Up",
  description: `Sign up to ${constants.title}`,
};

export default async function SignIn() {
  const session = await getServerComponentAuthSession();

  if (session?.user) {
    if (session?.user?.companyPublicId) {
      return redirect(`/${session.user.companyPublicId}`);
    }
    return redirect("/onboarding");
  }

  return <SignUpForm isGoogleAuthEnabled={IS_GOOGLE_AUTH_ENABLED} />;
}
