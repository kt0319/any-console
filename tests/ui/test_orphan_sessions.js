// @ts-check
import { describe, it, expect } from "vitest";
import { buildOrphanSessionList, AC_PREFIX } from "../../ui/utils/orphan-sessions.js";

describe("buildOrphanSessionList", () => {
  it("classifies ac- sessions as managed (external: false)", () => {
    const all = [{ name: "ac-abc123" }];
    const list = buildOrphanSessionList(all, [], new Set());
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
    const list = buildOrphanSessionList([{ name: "mywork" }], [], new Set());
    expect(list).toEqual([
      { session_id: null, tmux_name: "mywork", workspace: null, external: true },
    ]);
  });

  it("merges owned metadata by session_id", () => {
    const all = [{ name: "ac-xyz" }];
    const owned = [{ session_id: "xyz", workspace: "ws", icon: "mdi-play", icon_color: "#fff", job_name: "build", job_label: "Build" }];
    const list = buildOrphanSessionList(all, owned, new Set());
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
    const list = buildOrphanSessionList(all, [], new Set(["open1"]));
    expect(list).toHaveLength(1);
    expect(list[0].session_id).toBe("open2");
  });

  it("accepts an array for knownTabIds as well as a Set", () => {
    const all = [{ name: "ac-a" }, { name: "ac-b" }];
    const list = buildOrphanSessionList(all, [], ["a"]);
    expect(list.map((s) => s.session_id)).toEqual(["b"]);
  });

  it("handles null/undefined inputs gracefully", () => {
    expect(buildOrphanSessionList(null, null, null)).toEqual([]);
    expect(buildOrphanSessionList(undefined, undefined, undefined)).toEqual([]);
  });

  it("exposes the ac- prefix constant", () => {
    expect(AC_PREFIX).toBe("ac-");
  });
});
