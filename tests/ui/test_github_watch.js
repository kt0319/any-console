import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  acceptGitHubActivitySeq,
  buildWatchGitHubMessage,
  onGitHubWatchChange,
  rebaseGitHubActivitySeq,
  resetGitHubWatchForTest,
  unwatchGitHubWorkspace,
  watchGitHubWorkspace,
} from "../../ui/utils/github-watch.ts";

const message = () => JSON.parse(buildWatchGitHubMessage());

describe("github-watch", () => {
  beforeEach(() => resetGitHubWatchForTest());

  it("監視対象は重複を1件にまとめ、全員が外すまで残る", () => {
    watchGitHubWorkspace("b");
    watchGitHubWorkspace("a");
    watchGitHubWorkspace("a");
    expect(message().workspaces).toEqual(["a", "b"]);
    unwatchGitHubWorkspace("a");
    expect(message().workspaces).toEqual(["a", "b"]);
    unwatchGitHubWorkspace("a");
    expect(message().workspaces).toEqual(["b"]);
  });

  it("対象集合が変わった時だけ変更を通知する", () => {
    const listener = vi.fn();
    onGitHubWatchChange(listener);
    watchGitHubWorkspace("a");
    watchGitHubWorkspace("a");
    unwatchGitHubWorkspace("a");
    expect(listener).toHaveBeenCalledTimes(1);
    unwatchGitHubWorkspace("a");
    expect(listener).toHaveBeenCalledTimes(2);
    unwatchGitHubWorkspace("a");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("受信済みの seq を since として送る", () => {
    watchGitHubWorkspace("a");
    watchGitHubWorkspace("b");
    expect(acceptGitHubActivitySeq("a", 4)).toBe(true);
    expect(message()).toEqual({ type: "watch_github", workspaces: ["a", "b"], since: { a: 4 } });
  });

  it("処理済み以下の seq（再送と実配信の重複）は受け付けない", () => {
    watchGitHubWorkspace("a");
    expect(acceptGitHubActivitySeq("a", 2)).toBe(true);
    expect(acceptGitHubActivitySeq("a", 2)).toBe(false);
    expect(acceptGitHubActivitySeq("a", 1)).toBe(false);
    expect(acceptGitHubActivitySeq("a", 3)).toBe(true);
  });

  it("監視していないワークスペースの seq は受け付けない", () => {
    expect(acceptGitHubActivitySeq("a", 1)).toBe(false);
  });

  it("reset で seq を取り直すと、巻き戻った seq から再び受け付ける", () => {
    watchGitHubWorkspace("a");
    acceptGitHubActivitySeq("a", 5);
    rebaseGitHubActivitySeq("a", 0);
    expect(message().since).toEqual({ a: 0 });
    expect(acceptGitHubActivitySeq("a", 1)).toBe(true);
  });

  it("監視をやめた間の seq は捨て、再開時に過去分を再送させない", () => {
    watchGitHubWorkspace("a");
    acceptGitHubActivitySeq("a", 5);
    unwatchGitHubWorkspace("a");
    watchGitHubWorkspace("a");
    expect(message().since).toEqual({});
  });
});
