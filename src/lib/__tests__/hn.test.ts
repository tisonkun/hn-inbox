import { describe, expect, it } from "vitest";
import { cleanHnHtml } from "../hn";

describe("cleanHnHtml", () => {
  it("decodes entities, converts paragraph breaks, and expands truncated links", () => {
    const raw =
      'Very fun read.<p>RIP Kevin Lang<p><a href="https:&#x2F;&#x2F;example.com&#x2F;path?a=1&amp;b=2" rel="nofollow">https:&#x2F;&#x2F;example.com&#x2F;path...</a>';
    expect(cleanHnHtml(raw)).toBe(
      "Very fun read.\n\nRIP Kevin Lang\n\nhttps://example.com/path?a=1&b=2",
    );
  });

  it("keeps descriptive anchor text alongside its destination", () => {
    const raw =
      'See <a href="https://example.com/docs">the docs</a> for &quot;details&quot; &amp; &#x27;notes&#x27;.';
    expect(cleanHnHtml(raw)).toBe(
      'See the docs (https://example.com/docs) for "details" & \'notes\'.',
    );
  });
});
