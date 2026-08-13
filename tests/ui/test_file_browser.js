// @ts-check
import { describe, it, expect } from "vitest";
import {
  joinEntryPath, splitPathSegments, entrySizeText, buildGithubEntryUrl,
} from "../../ui/utils/file-browser.ts";

// ── Tests ──

describe("joinEntryPath", () => {
  it("joins parent path and name", () => {
    expect(joinEntryPath("src/components", "App.vue")).toBe("src/components/App.vue");
  });

  it("returns name when parent is empty", () => {
    expect(joinEntryPath("", "App.vue")).toBe("App.vue");
  });
});

describe("splitPathSegments", () => {
  it("splits path into segments", () => {
    expect(splitPathSegments("src/components/App.vue")).toEqual(["src", "components", "App.vue"]);
  });

  it("returns empty array for empty string", () => {
    expect(splitPathSegments("")).toEqual([]);
  });

  it("returns empty array for null", () => {
    expect(splitPathSegments(null)).toEqual([]);
  });

  it("ignores empty segments", () => {
    expect(splitPathSegments("/src//app/")).toEqual(["src", "app"]);
  });
});

describe("entrySizeText", () => {
  it("formats size for files", () => {
    expect(entrySizeText({ type: "file", size: 2048 })).toBe("2.0 KB");
  });

  it("returns empty for file without size", () => {
    expect(entrySizeText({ type: "file", size: null })).toBe("");
  });

  it("formats item count for dirs", () => {
    expect(entrySizeText({ type: "dir", count: 3 })).toBe("3 items");
  });

  it("uses singular for one item", () => {
    expect(entrySizeText({ type: "dir", count: 1 })).toBe("1 item");
  });

  it("formats 0 items", () => {
    expect(entrySizeText({ type: "dir", count: 0 })).toBe("0 items");
  });

  it("returns empty for dir without count", () => {
    expect(entrySizeText({ type: "dir", count: null })).toBe("");
  });
});

describe("buildGithubEntryUrl", () => {
  const ws = { github_url: "https://github.com/foo/bar", branch: "dev" };

  it("builds blob URL for files", () => {
    const url = buildGithubEntryUrl(ws, "src", { name: "app.js", type: "file" });
    expect(url).toBe("https://github.com/foo/bar/blob/dev/src/app.js");
  });

  it("builds tree URL for dirs", () => {
    const url = buildGithubEntryUrl(ws, "src", { name: "components", type: "dir" });
    expect(url).toBe("https://github.com/foo/bar/tree/dev/src/components");
  });

  it("omits parent path at root", () => {
    const url = buildGithubEntryUrl(ws, "", { name: "app.js", type: "file" });
    expect(url).toBe("https://github.com/foo/bar/blob/dev/app.js");
  });

  it("falls back to main when branch is missing", () => {
    const url = buildGithubEntryUrl({ github_url: "https://github.com/foo/bar" }, "", { name: "app.js", type: "file" });
    expect(url).toBe("https://github.com/foo/bar/blob/main/app.js");
  });

  it("returns empty without github_url", () => {
    expect(buildGithubEntryUrl({}, "", { name: "app.js", type: "file" })).toBe("");
  });

  it("returns empty without entry", () => {
    expect(buildGithubEntryUrl(ws, "", null)).toBe("");
  });

  it("returns empty for null workspace", () => {
    expect(buildGithubEntryUrl(null, "", { name: "a", type: "file" })).toBe("");
  });
});
