import { ProfileSettings } from "@/components/member/member-profile";
import { ViewAlertsSetting } from "@/components/member/view-alerts-setting";
import { api } from "@/trpc/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile",
};

const ProfileSettingsPage = async () => {
  const memberProfile = await api.member.getProfile.query();

  return (
    <>
      <ProfileSettings memberProfile={memberProfile} />
      <ViewAlertsSetting />
    </>
  );
};

export default ProfileSettingsPage;
