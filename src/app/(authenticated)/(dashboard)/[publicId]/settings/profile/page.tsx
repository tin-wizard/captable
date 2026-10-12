import { ProfileSettings } from "@/components/member/member-profile";
import { ViewAlertsSetting } from "@/components/member/view-alerts-setting";
import { domainConfig } from "@/server/domains/config";
import { getRequestHost } from "@/server/domains/request-host";
import { api } from "@/trpc/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Profile",
};

const ProfileSettingsPage = async (props: {
  params: Promise<{ publicId: string }>;
}) => {
  // Pages render in parallel with the layout, so its canonical redirect can lose
  // the race to getProfile, which is FORBIDDEN on a company or alias host.
  const { kind } = await getRequestHost();
  if (kind === "tenant" || kind === "alias") {
    const { publicId } = await props.params;
    redirect(`${domainConfig().canonicalOrigin}/${publicId}/settings/profile`);
  }
  const memberProfile = await api.member.getProfile.query();

  return (
    <>
      <ProfileSettings memberProfile={memberProfile} />
      <ViewAlertsSetting />
    </>
  );
};

export default ProfileSettingsPage;
