// @ts-check
import { describe, it, expect } from "vitest";
import { escapeHtml } from "../../ui/utils/escape-html.ts";

describe("escapeHtml", () => {
  it("escapes ampersand", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<div>hi</div>")).toBe("&lt;div&gt;hi&lt;/div&gt;");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("escapes all special chars in one pass", () => {
    expect(escapeHtml(`<a href="x">"&"</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&quot;&amp;&quot;&lt;/a&gt;",
    );
  });

  it("returns empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });
});
