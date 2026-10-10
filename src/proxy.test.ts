import { describe, expect, it } from "vitest";
import { logLine } from "./proxy";

describe("request log line", () => {
  it("never contains the query string", () => {
    const line = logLine(
      {
        method: "GET",
        url: "https://dealroom.tin.info/data-rooms/x?token=SECRET",
      },
      "1.2.3.4",
    );
    expect(line).toContain("/data-rooms/x");
    expect(line).not.toContain("SECRET");
    expect(line).not.toContain("?");
  });
});
