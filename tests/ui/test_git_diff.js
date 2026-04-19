// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitDiffByFile, getDiffStatusTone, renderNumstatHtml, renderNumstatNoteHtml } from "../../ui/utils/git-diff.js";

// ── Tests ──

describe("splitDiffByFile", () => {
  it("returns empty object for empty string", () => {
    assert.deepEqual(splitDiffByFile(""), {});
  });

  it("returns empty object for null", () => {
    assert.deepEqual(splitDiffByFile(null), {});
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
    assert.deepEqual(Object.keys(result), ["foo.js"]);
    assert.ok(result["foo.js"].includes("+added"));
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
    assert.deepEqual(Object.keys(result).sort(), ["a.txt", "b.txt"]);
    assert.ok(result["a.txt"].includes("+line a"));
    assert.ok(result["b.txt"].includes("+line b"));
  });

  it("handles nested paths", () => {
    const diff = "diff --git a/src/deep/file.js b/src/deep/file.js\n+content";
    const result = splitDiffByFile(diff);
    assert.deepEqual(Object.keys(result), ["src/deep/file.js"]);
  });

  it("uses full line as key when pattern does not match", () => {
    const diff = "diff --git malformed\n+content";
    const result = splitDiffByFile(diff);
    assert.deepEqual(Object.keys(result), ["diff --git malformed"]);
  });
});

describe("getDiffStatusTone", () => {
  it("returns 'add' for '??'", () => {
    assert.equal(getDiffStatusTone("??"), "add");
  });

  it("returns 'add' for 'A'", () => {
    assert.equal(getDiffStatusTone("A"), "add");
  });

  it("returns 'del' for 'D'", () => {
    assert.equal(getDiffStatusTone("D"), "del");
  });

  it("returns 'ren' for 'R'", () => {
    assert.equal(getDiffStatusTone("R"), "ren");
  });

  it("returns 'mod' for 'M'", () => {
    assert.equal(getDiffStatusTone("M"), "mod");
  });

  it("returns 'mod' for 'MM'", () => {
    assert.equal(getDiffStatusTone("MM"), "mod");
  });

  it("returns 'neutral' for empty string", () => {
    assert.equal(getDiffStatusTone(""), "neutral");
  });

  it("returns 'neutral' for null", () => {
    assert.equal(getDiffStatusTone(null), "neutral");
  });

  it("is case insensitive", () => {
    assert.equal(getDiffStatusTone("a"), "add");
    assert.equal(getDiffStatusTone("m"), "mod");
    assert.equal(getDiffStatusTone("d"), "del");
  });

  it("returns 'del' for 'AD' (D takes priority over position)", () => {
    assert.equal(getDiffStatusTone("AD"), "del");
  });
});

describe("renderNumstatHtml", () => {
  it("returns empty for non-finite values", () => {
    assert.equal(renderNumstatHtml(undefined, undefined), "");
    assert.equal(renderNumstatHtml(null, null), "");
    assert.equal(renderNumstatHtml(NaN, NaN), "");
  });

  it("renders insertions and deletions", () => {
    const html = renderNumstatHtml(10, 3);
    assert.ok(html.includes("+10"));
    assert.ok(html.includes("-3"));
    assert.ok(html.includes("diff-file-row-numstat"));
  });

  it("treats missing insertion as 0", () => {
    const html = renderNumstatHtml(undefined, 5);
    assert.ok(html.includes("+0"));
    assert.ok(html.includes("-5"));
  });

  it("treats missing deletion as 0", () => {
    const html = renderNumstatHtml(7, undefined);
    assert.ok(html.includes("+7"));
    assert.ok(html.includes("-0"));
  });

  it("renders zero values", () => {
    const html = renderNumstatHtml(0, 0);
    assert.ok(html.includes("+0"));
    assert.ok(html.includes("-0"));
  });

  it("includes extra class when provided", () => {
    const html = renderNumstatHtml(1, 2, "my-class");
    assert.ok(html.includes("diff-file-row-numstat my-class"));
  });
});

describe("renderNumstatNoteHtml", () => {
  it("wraps text in note span", () => {
    const html = renderNumstatNoteHtml("+42");
    assert.ok(html.includes("diff-file-row-numstat-note"));
    assert.ok(html.includes("+42"));
  });

  it("escapes HTML in text", () => {
    const html = renderNumstatNoteHtml("<script>");
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>"));
  });
});
