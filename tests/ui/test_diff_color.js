// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect } from "vitest";
import { escapeDiffHtml, colorDiff } from "../../ui/utils/diff-color.ts";

describe("escapeDiffHtml", () => {
  it("returns empty string for falsy input", () => {
    expect(escapeDiffHtml("")).toBe("");
    expect(escapeDiffHtml(null)).toBe("");
  });

  it("escapes HTML special characters", () => {
    expect(escapeDiffHtml("<a>&\"</a>")).toContain("&lt;a&gt;");
  });
});

describe("colorDiff", () => {
  it("returns empty for empty input", () => {
    expect(colorDiff("")).toBe("");
  });

  it("colors added lines in green", () => {
    const out = colorDiff("+added line");
    expect(out).toContain("--diff-add");
    expect(out).toContain("+added line");
  });

  it("colors removed lines in red", () => {
    const out = colorDiff("-removed");
    expect(out).toContain("--diff-del");
  });

  it("colors hunk headers in blue", () => {
    const out = colorDiff("@@ -1,3 +1,3 @@");
    expect(out).toContain("--diff-hunk");
  });

  it("leaves context lines unstyled", () => {
    const out = colorDiff(" context");
    expect(out).not.toContain("<span");
  });

  it("preserves newlines between lines", () => {
    const out = colorDiff("+a\n b\n-c");
    expect(out.split("\n").length).toBe(3);
  });
});
