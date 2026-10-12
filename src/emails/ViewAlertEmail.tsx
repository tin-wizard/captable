import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import { constants } from "../lib/constants";
import { BrandHeader } from "./components/BrandHeader";

interface ViewAlertEmailProps {
  companyName: string;
  who: string;
  label: string;
  occurrence: "first" | "return";
  link: string;
}

export const ViewAlertEmail = ({
  companyName,
  who,
  label,
  occurrence,
  link,
}: ViewAlertEmailProps) => {
  const verb = occurrence === "first" ? "opened" : "came back to";

  return (
    <Html>
      <Head />
      <Preview>{`${who} ${verb} ${label}`}</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-[40px] max-w-[465px] border-separate rounded border border-solid border-neutral-200 p-[20px]">
            <BrandHeader />
            <Heading className="mx-0 my-[30px] p-0 text-center text-[20px] font-normal text-black">
              <strong>{who}</strong> {verb} {label}
            </Heading>
            <Text className="text-[14px] leading-[24px] text-black">
              This was shared from <strong>{companyName}</strong> on{" "}
              {constants.title}. Previews from mail scanners are filtered out.
            </Text>
            <Section className="mb-[32px] mt-[32px] text-center">
              <Button
                className="rounded bg-black px-5 py-3 text-center text-[12px] font-semibold text-white no-underline"
                href={link}
              >
                Open in {constants.title}
              </Button>
            </Section>
            <Hr className="mx-0 my-[26px] w-full border border-solid border-neutral-200" />
            <Text className="text-[12px] leading-[20px] text-gray-400">
              You get this because activity alerts are on. Turn them off in
              Settings, Profile.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

ViewAlertEmail.PreviewProps = {
  companyName: "Batmobile",
  who: "Ivy",
  label: 'the data room "Series A"',
  occurrence: "first",
  link: "https://dealroom.tin.info/...",
} as ViewAlertEmailProps;

export default ViewAlertEmail;
