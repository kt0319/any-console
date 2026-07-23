// @ts-check
import { describe, it, expect } from "vitest";
import { buildDetachedSessionList, AC_PREFIX } from "../../ui/utils/detached-sessions.js";

describe("buildDetachedSessionList", () => {
  it("classifies ac- sessions as managed (external: false)", () => {
    const all = [{ name: "ac-abc123" }];
    const list = buildDetachedSessionList(all, [], new Set());
    expect(list).toEqual([
      {
        session_id: "abc123",
        tmux_name: "ac-abc123",
        workspace: null,
        icon: undefined,
        icon_color: undefined,
        job_name: undefined,
        job_label: undefined,
        external: false,
      },
    ]);
  });

  it("classifies non-prefixed sessions as external", () => {
    const list = buildDetachedSessionList([{ name: "mywork" }], [], new Set());
    expect(list).toEqual([
      { session_id: null, tmux_name: "mywork", workspace: null, external: true },
    ]);
  });

  it("uses the server-provided prefix to extract session ids", () => {
    // ANY_CONSOLE_TMUX_PREFIX 指定サーバ（E2E 使い捨てモード等）では
    // 既定 "ac-" のままだと session_id にプレフィックス残骸が混ざる
    const all = [{ name: "ac-e2e0aff11-abc123" }, { name: "ac-other" }];
    const list = buildDetachedSessionList(all, [], new Set(), "ac-e2e0aff11-");
    expect(list[0].session_id).toBe("abc123");
    expect(list[0].external).toBe(false);
    // 自サーバのプレフィックスに一致しない名前は external 扱い
    expect(list[1]).toEqual({
      session_id: null, tmux_name: "ac-other", workspace: null, external: true,
    });
  });

  it("merges owned metadata by session_id", () => {
    const all = [{ name: "ac-xyz" }];
    const owned = [{ session_id: "xyz", workspace: "ws", icon: "mdi-play", icon_color: "#fff", job_name: "build", job_label: "Build" }];
    const list = buildDetachedSessionList(all, owned, new Set());
    expect(list[0]).toMatchObject({
      session_id: "xyz",
      workspace: "ws",
      icon: "mdi-play",
      icon_color: "#fff",
      job_name: "build",
      job_label: "Build",
      external: false,
    });
  });

  it("excludes ac- sessions already open as tabs", () => {
    const all = [{ name: "ac-open1" }, { name: "ac-open2" }];
    const list = buildDetachedSessionList(all, [], new Set(["open1"]));
    expect(list).toHaveLength(1);
    expect(list[0].session_id).toBe("open2");
  });

  it("accepts an array for knownTabIds as well as a Set", () => {
    const all = [{ name: "ac-a" }, { name: "ac-b" }];
    const list = buildDetachedSessionList(all, [], ["a"]);
    expect(list.map((s) => s.session_id)).toEqual(["b"]);
  });

  it("handles null/undefined inputs gracefully", () => {
    expect(buildDetachedSessionList(null, null, null)).toEqual([]);
    expect(buildDetachedSessionList(undefined, undefined, undefined)).toEqual([]);
  });

  it("exposes the ac- prefix constant", () => {
    expect(AC_PREFIX).toBe("ac-");
  });
});
