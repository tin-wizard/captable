import { Img, Section, Text } from "@react-email/components";
import { env } from "../../env";
import { constants } from "../../lib/constants";

// Mail clients need an absolute URL. public/brand/tin-logo.png is a copy of
// src/assets/tin-logo.png; replace both to change the logo.
export const BrandHeader = () => (
  <Section className="mb-[8px] text-center">
    <Img
      src={`${env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, "")}/brand/tin-logo.png`}
      width="72"
      height="48"
      alt={constants.title}
      className="mx-auto"
    />
    <Text className="m-0 mt-[6px] text-[14px] font-semibold text-black">
      {constants.title}
    </Text>
  </Section>
);
