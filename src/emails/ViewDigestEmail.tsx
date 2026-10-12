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

interface ViewDigestEmailProps {
  companyName: string;
  rows: { who: string; label: string; visits: number; seconds: number }[];
  unopened: { who: string; label: string }[];
  link: string;
}

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export const ViewDigestEmail = ({
  companyName,
  rows,
  unopened,
  link,
}: ViewDigestEmailProps) => (
  <Html>
    <Head />
    <Preview>{`Activity on ${companyName} in the last 24 hours`}</Preview>
    <Tailwind>
      <Body className="mx-auto my-auto bg-white font-sans">
        <Container className="mx-auto my-[40px] max-w-[465px] border-separate rounded border border-solid border-neutral-200 p-[20px]">
          <BrandHeader />
          <Heading className="mx-0 my-[30px] p-0 text-center text-[20px] font-normal text-black">
            Activity on <strong>{companyName}</strong>
          </Heading>
          {rows.length > 0 && (
            <Section>
              <Text className="text-[14px] font-semibold text-black">
                Who looked
              </Text>
              {rows.map((r) => (
                <Text
                  key={`${r.who}-${r.label}`}
                  data-digest-row="view"
                  className="my-[4px] text-[14px] leading-[22px] text-black"
                >
                  {r.who} · {r.label} · {r.visits}{" "}
                  {r.visits === 1 ? "visit" : "visits"} · {mmss(r.seconds)}
                </Text>
              ))}
            </Section>
          )}
          {unopened.length > 0 && (
            <Section>
              <Text className="text-[14px] font-semibold text-black">
                Not opened yet
              </Text>
              {unopened.map((u) => (
                <Text
                  key={`${u.who}-${u.label}`}
                  data-digest-row="unopened"
                  className="my-[4px] text-[14px] leading-[22px] text-black"
                >
                  {u.who} · {u.label}
                </Text>
              ))}
            </Section>
          )}
          <Section className="mb-[32px] mt-[32px] text-center">
            <Button
              className="rounded bg-black px-5 py-3 text-center text-[12px] font-semibold text-white no-underline"
              href={link}
            >
              Open activity
            </Button>
          </Section>
          <Hr className="mx-0 my-[26px] w-full border border-solid border-neutral-200" />
          <Text className="text-[12px] leading-[20px] text-gray-400">
            You get this because the daily summary is on on {constants.title}.
            Change it in your profile settings.
          </Text>
        </Container>
      </Body>
    </Tailwind>
  </Html>
);

ViewDigestEmail.PreviewProps = {
  companyName: "Batmobile",
  rows: [
    { who: "Ivy", label: 'the data room "Series A"', visits: 2, seconds: 95 },
  ],
  unopened: [{ who: "Selina", label: 'the update "Q3"' }],
  link: "https://dealroom.tin.info/...",
} as ViewDigestEmailProps;

export default ViewDigestEmail;
