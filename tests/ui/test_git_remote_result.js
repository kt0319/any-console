// @ts-check
import { describe, it, expect } from "vitest";
import { buildActionResult, buildRemoteResult, formatCommitSubjects } from "../../ui/utils/git-remote.ts";

describe("buildRemoteResult", () => {
  it("コミットなしのPullはPulledと区別できる専用文言", () => {
    expect(buildRemoteResult("Pull", {})).toEqual({ kind: "none", headline: "Already up to date", detail: "" });
  });

  it("コミットなしのPushも専用文言", () => {
    expect(buildRemoteResult("Push", {})).toEqual({ kind: "none", headline: "Nothing to push", detail: "" });
  });

  it("コミット1件は件数と件名を返す", () => {
    expect(buildRemoteResult("Pull", { commits: { count: 1, messages: ["fix: null pointer error"] } })).toEqual({
      kind: "pull",
      headline: "1 Pulled",
      detail: "fix: null pointer error",
    });
  });

  it("複数件でも最新の1件の件名だけ出し、残りは more にまとめる", () => {
    const result = buildRemoteResult("Push", {
      commits: { count: 3, messages: ["feat: a", "fix: b", "docs: c"] },
    });
    expect(result.kind).toBe("push");
    expect(result.headline).toBe("3 Pushed");
    expect(result.detail).toBe("feat: a \u2026 and 2 more");
  });

  it("複数行のコミットメッセージは件名行（1行目）のみ使う", () => {
    const result = buildRemoteResult("Pull", {
      commits: { count: 1, messages: ["feat: title\n\nBody detail text"] },
    });
    expect(result.detail).toBe("feat: title");
  });

  it("upstream未設定の初回pushもPushedと同じ扱い", () => {
    expect(buildRemoteResult("Push (set upstream)", { commits: { count: 1, messages: ["feat: first push"] } })).toEqual({
      kind: "push",
      headline: "1 Pushed",
      detail: "feat: first push",
    });
    expect(buildRemoteResult("Push (set upstream)", {}).headline).toBe("Nothing to push");
  });
});

describe("formatCommitSubjects", () => {
  it("件名を区切り文字で連結する", () => {
    expect(formatCommitSubjects(["a", "b"], 2)).toBe("a \u2022 b");
  });

  it("件名が総数より少なければ残件数を付ける", () => {
    expect(formatCommitSubjects(["a", "b", "c"], 5)).toBe("a \u2022 b \u2022 c \u2026 and 2 more");
  });

  it("件名が空なら空文字（総数だけでは何も出さない）", () => {
    expect(formatCommitSubjects([], 4)).toBe("");
  });
});

describe("buildActionResult", () => {
  it("push/pull以外の操作結果をkind noneで返す", () => {
    expect(buildActionResult("Committed", "feat: x")).toEqual({ kind: "none", headline: "Committed", detail: "feat: x" });
    expect(buildActionResult("Fetched remote")).toEqual({ kind: "none", headline: "Fetched remote", detail: "" });
  });
});
