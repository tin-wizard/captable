import { describe, expect, it } from "vitest";
import { sanitizeUpdateHtml } from "./sanitize-update-html";

describe("sanitizeUpdateHtml", () => {
  it.each([
    ['<p>hi</p><script>fetch("/api/trpc")</script>', "<p>hi</p>"],
    [
      '<img src="https://x.test/a.png" onerror="alert(1)" />',
      '<img src="https://x.test/a.png" />',
    ],
    ['<a href="javascript:alert(1)">x</a>', "<a>x</a>"],
    ['<img src="data:text/html;base64,PHNjcmlwdD4=" />', "<img />"],
    ['<iframe src="https://evil.test"></iframe><p>ok</p>', "<p>ok</p>"],
    ['<p style="color:red" onclick="x()">a</p>', "<p>a</p>"],
  ])("strips script-capable markup: %s", (dirty, clean) => {
    expect(sanitizeUpdateHtml(dirty)).toBe(clean);
  });

  it("keeps the formatting the editor produces", () => {
    const html =
      "<h1>Q3</h1><h2>Ops</h2><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s></p>" +
      "<ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote>" +
      '<pre><code>c</code></pre><a href="https://tin.info">link</a>' +
      "<table><tbody><tr><td>1</td></tr></tbody></table>";
    expect(sanitizeUpdateHtml(html)).toBe(html);
  });
});
