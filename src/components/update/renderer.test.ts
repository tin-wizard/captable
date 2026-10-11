import { render } from "@react-email/components";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import UpdateRenderer from "./renderer";

describe("UpdateRenderer", () => {
  it("sanitises stored html before rendering", async () => {
    const out = await render(
      createElement(UpdateRenderer, {
        html: '<p>ok</p><img src="x" onerror="alert(1)"><script>alert(2)</script>',
      }),
    );
    expect(out).toContain("ok");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("<script");
  });
});
