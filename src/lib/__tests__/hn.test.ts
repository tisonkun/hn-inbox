import { describe, expect, it } from "vitest";
import { cleanHnHtml } from "../hn";

describe("cleanHnHtml", () => {
  it("normalizes unclosed HN paragraphs, hex/named entities, and truncated links", () => {
    const raw =
      'Very fun read.<p>RIP Kevin Lang<p><a href="https:&#x2F;&#x2F;example.com&#x2F;path?a=1&amp;b=2" rel="nofollow">https:&#x2F;&#x2F;example.com&#x2F;path...</a> &amp; &#x27;notes&#x27;';
    expect(cleanHnHtml(raw)).toBe(
      "Very fun read.\n\nRIP Kevin Lang\n\nhttps://example.com/path?a=1&b=2 & 'notes'",
    );
  });
});
