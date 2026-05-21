// @ts-check
import { describe, it, expect } from "vitest";
import { formatRemoteToast } from "../../ui/utils/git-remote.js";

describe("formatRemoteToast", () => {
  it("コミットなしの場合はシンプルなヘッダーのみ", () => {
    const msg = formatRemoteToast("my-ws", "Pull", {});
    expect(msg).toBe("my-ws: Pull done");
  });

  it("コミット1件の場合は singular 表現でメッセージを表示", () => {
    const msg = formatRemoteToast("my-ws", "Pull", {
      commits: { count: 1, messages: ["fix: null pointer error"] },
    });
    expect(msg).toBe("my-ws: Pull done (1 commit)\n• fix: null pointer error");
  });

  it("直近3件のコミットメッセージを箇条書きで表示", () => {
    const msg = formatRemoteToast("ws", "Push", {
      commits: { count: 3, messages: ["feat: a", "fix: b", "docs: c"] },
    });
    const lines = msg.split("\n");
    expect(lines[0]).toBe("ws: Push done (3 commits)");
    expect(lines).toContain("• feat: a");
    expect(lines).toContain("• fix: b");
    expect(lines).toContain("• docs: c");
    expect(msg).not.toContain("more");
  });

  it("メッセージが3件を超える場合は残件数を表示", () => {
    const msg = formatRemoteToast("ws", "Push", {
      commits: { count: 5, messages: ["a", "b", "c"] },
    });
    expect(msg).toContain("… and 2 more");
  });

  it("複数行のコミットメッセージは件名行（1行目）のみ使用", () => {
    const msg = formatRemoteToast("ws", "Pull", {
      commits: { count: 1, messages: ["feat: title\n\nBody detail text"] },
    });
    expect(msg).toContain("• feat: title");
    expect(msg).not.toContain("Body detail text");
  });
});
