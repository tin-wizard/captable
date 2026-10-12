import { describe, expect, it } from "vitest";
import { isAtypicalSource, truncateIp } from "./view-events";

const SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

describe("isAtypicalSource", () => {
  it.each([
    "",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Slackbot-LinkExpanding 1.0",
    "curl/8.4.0",
    "Mozilla/5.0 SafeLinks Protection",
  ])("flags %j", (ua) => expect(isAtypicalSource(ua)).toBe(true));

  it.each([SAFARI, CHROME])("passes a real browser", (ua) =>
    expect(isAtypicalSource(ua)).toBe(false),
  );
});

describe("truncateIp", () => {
  it.each([
    ["203.0.113.9", "203.0.113.0"],
    ["127.0.0.1", "127.0.0.0"],
    ["::ffff:198.51.100.7", "198.51.100.0"],
    ["2001:db8:85a3:8d3:1319:8a2e:370:7344", "2001:db8:85a3::"],
    ["2001:db8::1", "2001:db8::"],
    ["::1", "::"],
    ["not-an-ip", ""],
    ["203.0.113.9:443", "203.0.113.0"],
    ["[2001:db8::1]:443", "2001:db8::"],
    ["203.0.113.9:443:x", ""],
  ])("%s -> %s", (input, expected) => expect(truncateIp(input)).toBe(expected));
});
