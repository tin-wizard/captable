import { render } from "@react-email/components";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import AccountVerificationEmail from "./AccountVerificationEmail";
import EsignConfirmationEmail from "./EsignConfirmationEmail";
import EsignEmail from "./EsignEmail";
import MagicLinkEmail from "./MagicLinkEmail";
import MemberInviteEmail from "./MemberInviteEmail";
import PasswordResetEmail from "./PasswordResetEmail";
import ShareDataRoomEmail from "./ShareDataRoomEmail";
import ShareUpdateEmail from "./ShareUpdateEmail";

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_BASE_URL: "https://dealroom.tin.info" },
}));

// each template renders with its own preview props
const templates = {
  AccountVerificationEmail,
  EsignConfirmationEmail,
  EsignEmail,
  MagicLinkEmail,
  MemberInviteEmail,
  PasswordResetEmail,
  ShareDataRoomEmail,
  ShareUpdateEmail,
} as const;

describe("email branding", () => {
  it.each(Object.entries(templates))(
    "%s shows the TIN logo and no Captable branding",
    async (_name, Template) => {
      const props = (Template as unknown as { PreviewProps?: object })
        .PreviewProps;
      const html = await render(
        createElement(Template as never, props as never),
      );
      expect(html).toContain("/brand/tin-logo.png");
      expect(html).toContain("Deal Room");
      expect(html).not.toMatch(/captable/i);
    },
  );

  it("invite email keeps the company name dynamic", async () => {
    const html = await render(
      MemberInviteEmail({
        invitedBy: "Tanzin",
        companyName: "Konnect",
        inviteLink: "https://dealroom.tin.info/verify-member/t",
      }),
    );
    expect(html).toContain("Konnect");
    expect(html).toContain("Join the team");
    expect(html).toContain("https://dealroom.tin.info/verify-member/t");
  });
});
