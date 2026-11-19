// @ts-check
import { describe, it, expect } from "vitest";
import { filterPaletteItems, isBranchNameCandidate, looksLikePath, movePaletteIndex, queryActionKinds, resolvePaletteIcons } from "../../ui/utils/command-palette.ts";

const noop = () => {};
const items = [
  { id: "a", group: "Actions", label: "New Terminal", icons: [{ name: "mdi-console" }], run: noop },
  { id: "b", group: "Tabs", label: "any-console | main", icons: [{ name: "mdi-tab" }], run: noop },
  { id: "c", group: "Jobs", label: "any-console | Build", icons: [{ name: "mdi-play" }], run: noop },
];

describe("filterPaletteItems", () => {
  it("returns all items for an empty or blank query", () => {
    expect(filterPaletteItems(items, "")).toEqual(items);
    expect(filterPaletteItems(items, "   ")).toEqual(items);
  });

  it("matches case-insensitively", () => {
    expect(filterPaletteItems(items, "NEW term").map((i) => i.id)).toEqual(["a"]);
  });

  it("requires every whitespace-separated word to match", () => {
    expect(filterPaletteItems(items, "console build").map((i) => i.id)).toEqual(["c"]);
    expect(filterPaletteItems(items, "console nothing")).toEqual([]);
  });

  it("matches the group name", () => {
    expect(filterPaletteItems(items, "tabs").map((i) => i.id)).toEqual(["b"]);
  });
});

describe("movePaletteIndex", () => {
  it("moves within range", () => {
    expect(movePaletteIndex(0, 1, 3)).toBe(1);
    expect(movePaletteIndex(2, -1, 3)).toBe(1);
  });

  it("wraps around at both ends", () => {
    expect(movePaletteIndex(2, 1, 3)).toBe(0);
    expect(movePaletteIndex(0, -1, 3)).toBe(2);
  });

  it("returns 0 when there are no items", () => {
    expect(movePaletteIndex(0, 1, 0)).toBe(0);
  });
});

describe("resolvePaletteIcons", () => {
  it("keeps the named candidates in order", () => {
    expect(resolvePaletteIcons([{ name: "mdi-a", color: "#fff" }, { name: "mdi-b" }], "mdi-x"))
      .toEqual([{ name: "mdi-a", color: "#fff" }, { name: "mdi-b" }]);
  });

  it("skips empty / missing candidates", () => {
    expect(resolvePaletteIcons([null, undefined, { name: "" }, { name: "mdi-b" }], "mdi-x")).toEqual([{ name: "mdi-b" }]);
  });

  it("falls back when no candidate has a name", () => {
    expect(resolvePaletteIcons([{ name: "" }, null], "mdi-x")).toEqual([{ name: "mdi-x" }]);
  });
});

describe("isBranchNameCandidate", () => {
  it("accepts typical branch names", () => {
    for (const name of ["main", "feature/login", "fix-123", "release-1.2", "user/feat_x"]) {
      expect(isBranchNameCandidate(name)).toBe(true);
    }
  });

  it("rejects names git refuses", () => {
    for (const name of ["", "@", "a b", "a..b", "a//b", "a@{b", "-x", "/x", ".x", "x/", "x.", "x.lock", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b", "a/.b"]) {
      expect(isBranchNameCandidate(name)).toBe(false);
    }
  });
});

describe("looksLikePath", () => {
  it("detects absolute, home, relative and extension-bearing names", () => {
    for (const text of ["/etc/hosts", "~/a", "~", "./a", "../a", "src/main.ts", "README.md"]) {
      expect(looksLikePath(text)).toBe(true);
    }
  });

  it("does not treat branch-like names or text with spaces as paths", () => {
    for (const text of ["feature/login", "main", "v1.2", "a b.txt"]) {
      expect(looksLikePath(text)).toBe(false);
    }
  });
});

describe("queryActionKinds", () => {
  const both = { canCreateBranch: true, hasSession: true };

  it("puts branch creation first for branch-like input", () => {
    expect(queryActionKinds("feature-x", both)).toEqual(["create-branch", "create-worktree", "send-text", "open-path"]);
  });

  it("puts open-path first for path-like input", () => {
    expect(queryActionKinds("src/a.ts", both)).toEqual(["open-path", "send-text", "create-branch", "create-worktree"]);
  });

  it("omits operations that cannot run", () => {
    expect(queryActionKinds("feature-x", { canCreateBranch: false, hasSession: true })).toEqual(["send-text", "open-path"]);
    expect(queryActionKinds("feature-x", { canCreateBranch: true, hasSession: false })).toEqual(["create-branch", "create-worktree"]);
    expect(queryActionKinds("feature-x", { canCreateBranch: false, hasSession: false })).toEqual([]);
  });

  it("returns nothing for a blank query", () => {
    expect(queryActionKinds("   ", both)).toEqual([]);
  });
});
