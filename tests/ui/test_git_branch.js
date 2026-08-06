// @ts-check
import { describe, it, expect } from "vitest";
import { normalizeLocalBranches, filterRemoteBranches, buildWorktreeMap, canPull, canPush } from "../../ui/utils/git-branch.js";

// ── Tests ──

describe("normalizeLocalBranches", () => {
  it("nullで空配列", () => {
    expect(normalizeLocalBranches(null)).toEqual([]);
  });

  it("オブジェクト形式を正規化する", () => {
    const result = normalizeLocalBranches([
      { name: "main", current: true, is_default: true, ahead: "2", behind: "1", upstream: "origin/main", gone: false },
    ]);
    expect(result).toEqual([
      { name: "main", current: true, isDefault: true, remote: false, ahead: 2, behind: 1, upstream: "origin/main", gone: false },
    ]);
  });

  it("文字列要素はnameとして扱いデフォルト値を補完する", () => {
    const result = normalizeLocalBranches(["feature/x"]);
    expect(result).toEqual([
      { name: "feature/x", current: false, isDefault: false, remote: false, ahead: 0, behind: 0, upstream: null, gone: false },
    ]);
  });

  it("ahead/behindが数値でない場合は0にする", () => {
    const [b] = normalizeLocalBranches([{ name: "dev", ahead: "abc", behind: undefined }]);
    expect(b.ahead).toBe(0);
    expect(b.behind).toBe(0);
  });

  it("現在ブランチを一覧の先頭に並べ替える", () => {
    const result = normalizeLocalBranches([
      { name: "a" },
      { name: "b", current: true },
      { name: "c" },
    ]);
    expect(result.map((b) => b.name)).toEqual(["b", "a", "c"]);
  });

  it("現在ブランチが無ければ元の順序のまま", () => {
    const result = normalizeLocalBranches([{ name: "a" }, { name: "b" }]);
    expect(result.map((b) => b.name)).toEqual(["a", "b"]);
  });
});

describe("filterRemoteBranches", () => {
  it("nullで空配列", () => {
    expect(filterRemoteBranches(null, [])).toEqual([]);
  });

  it("ローカルに存在するブランチを除外する", () => {
    const result = filterRemoteBranches(
      [{ name: "main" }, { name: "feature/y" }],
      [{ name: "main" }],
    );
    expect(result).toEqual([{ name: "feature/y", current: false, remote: true }]);
  });

  it("文字列要素もnameとして扱う", () => {
    const result = filterRemoteBranches(["main", "dev"], [{ name: "main" }]);
    expect(result).toEqual([{ name: "dev", current: false, remote: true }]);
  });

  it("localBranchesが未指定でも動作する", () => {
    const result = filterRemoteBranches([{ name: "dev" }], undefined);
    expect(result).toEqual([{ name: "dev", current: false, remote: true }]);
  });
});

describe("buildWorktreeMap", () => {
  it("nullで空オブジェクト", () => {
    expect(buildWorktreeMap(null)).toEqual({});
  });

  it("branchをキーにマップする", () => {
    const wtA = { branch: "main", path: "/a", is_main: true };
    const wtB = { branch: "feature/z", path: "/b", is_main: false };
    expect(buildWorktreeMap([wtA, wtB])).toEqual({ main: wtA, "feature/z": wtB });
  });

  it("branchが無いworktreeは無視する", () => {
    expect(buildWorktreeMap([{ path: "/detached" }])).toEqual({});
  });
});

describe("canPull", () => {
  it("upstreamがありbehind > 0ならtrue", () => {
    expect(canPull({ remote: false, upstream: "origin/main", behind: 2 })).toBe(true);
  });

  it("リモートブランチはfalse", () => {
    expect(canPull({ remote: true, upstream: "origin/main", behind: 2 })).toBe(false);
  });

  it("upstreamが無ければfalse", () => {
    expect(canPull({ remote: false, upstream: null, behind: 2 })).toBe(false);
  });

  it("behindが0ならfalse", () => {
    expect(canPull({ remote: false, upstream: "origin/main", behind: 0 })).toBe(false);
  });
});

describe("canPush", () => {
  it("リモートブランチはfalse", () => {
    expect(canPush({ remote: true, upstream: null, ahead: 1 })).toBe(false);
  });

  it("upstream未設定ならtrue", () => {
    expect(canPush({ remote: false, upstream: null, ahead: 0 })).toBe(true);
  });

  it("upstreamありでahead > 0ならtrue", () => {
    expect(canPush({ remote: false, upstream: "origin/main", ahead: 3 })).toBe(true);
  });

  it("upstreamありでahead 0ならfalse", () => {
    expect(canPush({ remote: false, upstream: "origin/main", ahead: 0 })).toBe(false);
  });
});
