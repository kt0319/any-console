import { describe, it, expect } from "vitest";
import { useCommitDiffFiles } from "../../ui/composables/useCommitDiffFiles.ts";

describe("useCommitDiffFiles", () => {
  it("取得したファイル一覧とdiffChunksを保持し、closeで空に戻す", async () => {
    const state = useCommitDiffFiles();
    await state.openDiffFiles({ hash: "abc" }, async () => ({
      fileList: [{ path: "a.txt", status: "M" }],
      diffChunks: { "a.txt": "diff --git a/a.txt b/a.txt" },
    }));
    expect(state.files.value).toHaveLength(1);
    expect(state.diffChunks.value["a.txt"]).toContain("diff --git");

    state.close();
    expect(state.files.value).toEqual([]);
    expect(state.diffChunks.value).toEqual({});
  });

  it("次のコミットを開く時に前のdiffChunksを持ち越さない", async () => {
    const state = useCommitDiffFiles();
    await state.openDiffFiles({ hash: "a" }, async () => ({ fileList: [], diffChunks: { "x": "old" } }));
    await state.openDiffFiles({ hash: "b" }, async () => null);
    expect(state.diffChunks.value).toEqual({});
  });
});
