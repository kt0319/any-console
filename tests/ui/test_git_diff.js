// @ts-check
import { describe, it, expect } from "vitest";
import { splitDiffByFile, getDiffStatusTone, renderNumstatHtml, renderNumstatNoteHtml } from "../../ui/utils/git-diff.js";

// ── Tests ──

describe("splitDiffByFile", () => {
  it("returns empty object for empty string", () => {
    expect(splitDiffByFile("")).toEqual({});
  });

  it("returns empty object for null", () => {
    expect(splitDiffByFile(null)).toEqual({});
  });

  it("splits single file diff", () => {
    const diff = [
      "diff --git a/foo.js b/foo.js",
      "index 1234..5678 100644",
      "--- a/foo.js",
      "+++ b/foo.js",
      "@@ -1,3 +1,4 @@",
      " line1",
      "+added",
    ].join("\n");
    const result = splitDiffByFile(diff);
    expect(Object.keys(result)).toEqual(["foo.js"]);
    expect(result["foo.js"].includes("+added")).toBeTruthy();
  });

  it("splits multiple file diffs", () => {
    const diff = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "+line a",
      "diff --git a/b.txt b/b.txt",
      "--- a/b.txt",
      "+++ b/b.txt",
      "+line b",
    ].join("\n");
    const result = splitDiffByFile(diff);
    expect(Object.keys(result).sort()).toEqual(["a.txt", "b.txt"]);
    expect(result["a.txt"].includes("+line a")).toBeTruthy();
    expect(result["b.txt"].includes("+line b")).toBeTruthy();
  });

  it("handles nested paths", () => {
    const diff = "diff --git a/src/deep/file.js b/src/deep/file.js\n+content";
    const result = splitDiffByFile(diff);
    expect(Object.keys(result)).toEqual(["src/deep/file.js"]);
  });

  it("uses full line as key when pattern does not match", () => {
    const diff = "diff --git malformed\n+content";
    const result = splitDiffByFile(diff);
    expect(Object.keys(result)).toEqual(["diff --git malformed"]);
  });
});

describe("getDiffStatusTone", () => {
  it("returns 'add' for '??'", () => {
    expect(getDiffStatusTone("??")).toBe("add");
  });

  it("returns 'add' for 'A'", () => {
    expect(getDiffStatusTone("A")).toBe("add");
  });

  it("returns 'del' for 'D'", () => {
    expect(getDiffStatusTone("D")).toBe("del");
  });

  it("returns 'ren' for 'R'", () => {
    expect(getDiffStatusTone("R")).toBe("ren");
  });

  it("returns 'mod' for 'M'", () => {
    expect(getDiffStatusTone("M")).toBe("mod");
  });

  it("returns 'mod' for 'MM'", () => {
    expect(getDiffStatusTone("MM")).toBe("mod");
  });

  it("returns 'neutral' for empty string", () => {
    expect(getDiffStatusTone("")).toBe("neutral");
  });

  it("returns 'neutral' for null", () => {
    expect(getDiffStatusTone(null)).toBe("neutral");
  });

  it("is case insensitive", () => {
    expect(getDiffStatusTone("a")).toBe("add");
    expect(getDiffStatusTone("m")).toBe("mod");
    expect(getDiffStatusTone("d")).toBe("del");
  });

  it("returns 'del' for 'AD' (D takes priority over position)", () => {
    expect(getDiffStatusTone("AD")).toBe("del");
  });
});

describe("renderNumstatHtml", () => {
  it("returns empty for non-finite values", () => {
    expect(renderNumstatHtml(undefined, undefined)).toBe("");
    expect(renderNumstatHtml(null, null)).toBe("");
    expect(renderNumstatHtml(NaN, NaN)).toBe("");
  });

  it("renders insertions and deletions", () => {
    const html = renderNumstatHtml(10, 3);
    expect(html.includes("+10")).toBeTruthy();
    expect(html.includes("-3")).toBeTruthy();
    expect(html.includes("diff-file-row-numstat")).toBeTruthy();
  });

  it("treats missing insertion as 0", () => {
    const html = renderNumstatHtml(undefined, 5);
    expect(html.includes("+0")).toBeTruthy();
    expect(html.includes("-5")).toBeTruthy();
  });

  it("treats missing deletion as 0", () => {
    const html = renderNumstatHtml(7, undefined);
    expect(html.includes("+7")).toBeTruthy();
    expect(html.includes("-0")).toBeTruthy();
  });

  it("renders zero values", () => {
    const html = renderNumstatHtml(0, 0);
    expect(html.includes("+0")).toBeTruthy();
    expect(html.includes("-0")).toBeTruthy();
  });

  it("includes extra class when provided", () => {
    const html = renderNumstatHtml(1, 2, "my-class");
    expect(html.includes("diff-file-row-numstat my-class")).toBeTruthy();
  });
});

describe("renderNumstatNoteHtml", () => {
  it("wraps text in note span", () => {
    const html = renderNumstatNoteHtml("+42");
    expect(html.includes("diff-file-row-numstat-note")).toBeTruthy();
    expect(html.includes("+42")).toBeTruthy();
  });

  it("escapes HTML in text", () => {
    const html = renderNumstatNoteHtml("<script>");
    expect(html.includes("&lt;script&gt;")).toBeTruthy();
    expect(!html.includes("<script>")).toBeTruthy();
  });
});
