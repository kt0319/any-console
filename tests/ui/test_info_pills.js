import { describe, it, expect } from "vitest";
import { INFO_PILLS, INFO_PILL_FIELDS, peekIconForKey, peekColorForKey } from "../../ui/utils/info-pills.js";

describe("peekColorForKey", () => {
  it("キーごとの静的な色クラスを返す", () => {
    expect(peekColorForKey("history")).toBe("pill-peek-accent");
    expect(peekColorForKey("changes")).toBe("pill-peek-warning");
    expect(peekColorForKey("prs")).toBe("pill-peek-purple");
    expect(peekColorForKey("branch")).toEqual(["pill-peek-success", "pill-peek-icon-only"]);
    expect(peekColorForKey("devserver")).toBe("pill-peek-accent");
    expect(peekColorForKey("dispatch")).toBe("pill-peek-pink");
    expect(peekColorForKey("actions")).toBe("pill-peek-brown");
  });

  it("色指定の無いキー（files/add等）・未知キーは空文字", () => {
    expect(peekColorForKey("files")).toBe("");
    expect(peekColorForKey("add")).toBe("");
    expect(peekColorForKey("workspace")).toBe("");
    expect(peekColorForKey(null)).toBe("");
  });

  it("actionsはアイコンを常にブラウン固定にしつつ、branchActionの状態に応じてステータス部分だけ4段階（実行中/成功/失敗/neutral）に色分けされる", () => {
    // 実行中系（status !== completed）はconclusion問わずrunning
    expect(peekColorForKey("actions", { branchAction: { status: "in_progress", conclusion: null } }))
      .toEqual(["pill-peek-brown", "pill-peek-actions-running"]);
    expect(peekColorForKey("actions", { branchAction: { status: "queued", conclusion: null } }))
      .toEqual(["pill-peek-brown", "pill-peek-actions-running"]);
    // 完了後はconclusionでバケット分け
    expect(peekColorForKey("actions", { branchAction: { status: "completed", conclusion: "success" } }))
      .toEqual(["pill-peek-brown", "pill-peek-actions-success"]);
    expect(peekColorForKey("actions", { branchAction: { status: "completed", conclusion: "failure" } }))
      .toEqual(["pill-peek-brown", "pill-peek-actions-failure"]);
    expect(peekColorForKey("actions", { branchAction: { status: "completed", conclusion: "timed_out" } }))
      .toEqual(["pill-peek-brown", "pill-peek-actions-failure"]);
    expect(peekColorForKey("actions", { branchAction: { status: "completed", conclusion: "action_required" } }))
      .toEqual(["pill-peek-brown", "pill-peek-actions-running"]);
    for (const conclusion of ["cancelled", "skipped", "neutral", "stale"]) {
      expect(peekColorForKey("actions", { branchAction: { status: "completed", conclusion } }))
        .toEqual(["pill-peek-brown", "pill-peek-actions-neutral"]);
    }
    // 未知のconclusionもneutralへフォールバックする
    expect(peekColorForKey("actions", { branchAction: { status: "completed", conclusion: "something-new" } }))
      .toEqual(["pill-peek-brown", "pill-peek-actions-neutral"]);
    // branchActionが無い・fields省略時は従来どおりブラウン固定のみ
    expect(peekColorForKey("actions", { branchAction: null })).toBe("pill-peek-brown");
    expect(peekColorForKey("actions")).toBe("pill-peek-brown");
  });
});

describe("INFO_PILLS", () => {
  it("キーは重複しない", () => {
    const keys = INFO_PILLS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("全エントリがkey/label/note/peekIconを持つ", () => {
    for (const p of INFO_PILLS) {
      expect(p.key).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.note).toBeTruthy();
      expect(p.peekIcon).toMatch(/^mdi-/);
    }
  });

  it("フィールド一覧＝デフォルト表示順（並び替え保存が無い時の表示順を規定する）", () => {
    // バックエンド server/src/settings.rs の INFO_PILL_FIELDS と同じキー集合を
    // 保つこと（あちらは settings.rs 内のユニットテストで検証）。
    expect(INFO_PILL_FIELDS).toEqual([
      "files", "history", "changes", "branch", "prs", "actions", "devserver", "add", "dispatch",
    ]);
  });
});

describe("peekIconForKey", () => {
  it("ピルのキーに対応するアイコンを返す", () => {
    expect(peekIconForKey("branch")).toBe("mdi-source-branch");
    expect(peekIconForKey("devserver")).toBe("mdi-server");
  });

  it("peek専用キー（devserver-stop）にもアイコンを返す", () => {
    expect(peekIconForKey("devserver-stop")).toBe("mdi-server-off");
  });

  it("対応するピルが無いキーは空文字（テンプレート側が実アイコンを描画）", () => {
    expect(peekIconForKey("workspace")).toBe("");
    expect(peekIconForKey(null)).toBe("");
    expect(peekIconForKey(undefined)).toBe("");
  });
});
