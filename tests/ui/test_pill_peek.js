// @ts-check
import { describe, it, expect } from "vitest";
import {
  trailingItemsSignature,
  findChangedTrailingItems,
  buildTrailingPeekItems,
  buildPeekText,
  buildPeekSignature,
} from "../../ui/utils/pill-peek.ts";

const ALL_ON = {
  files: true,
  changes: true,
  branch: true,
  history: true,
  prs: true,
  actions: true,
  devserver: true,
  add: true,
  dispatch: true,
};

describe("trailingItemsSignature / findChangedTrailingItems", () => {
  it("シグネチャはkey→textのMapを作る", () => {
    const sig = trailingItemsSignature([{ key: "a", text: "1" }, { key: "b", text: "2" }]);
    expect(sig.get("a")).toBe("1");
    expect(sig.get("b")).toBe("2");
  });

  it("空配列/未指定でも空のMapを返す", () => {
    expect(trailingItemsSignature([]).size).toBe(0);
    expect(trailingItemsSignature(undefined).size).toBe(0);
  });

  it("text が変わった項目・新規追加された項目を返す", () => {
    const prev = trailingItemsSignature([{ key: "a", text: "1" }]);
    const changed = findChangedTrailingItems(
      [{ key: "a", text: "2" }, { key: "b", text: "new" }],
      prev,
    );
    expect(changed).toEqual([{ key: "a", text: "2" }, { key: "b", text: "new" }]);
  });

  it("変化が無ければ空配列", () => {
    const prev = trailingItemsSignature([{ key: "a", text: "1" }]);
    expect(findChangedTrailingItems([{ key: "a", text: "1" }], prev)).toEqual([]);
  });

  it("複数変化していれば items の並び順で全て返す", () => {
    const prev = trailingItemsSignature([
      { key: "branch", text: "main" },
      { key: "push", text: "1" },
    ]);
    const items = [
      { key: "branch", text: "feature/x" },
      { key: "push", text: "2" },
    ];
    expect(findChangedTrailingItems(items, prev)).toEqual(items);
  });

  it("項目が消えた場合は残っている項目に変化が無ければ空配列", () => {
    const prev = trailingItemsSignature([
      { key: "branch", text: "main" },
      { key: "push", text: "1" },
    ]);
    const items = [{ key: "branch", text: "main" }];
    expect(findChangedTrailingItems(items, prev)).toEqual([]);
  });
});

describe("buildTrailingPeekItems", () => {
  it("workspaceは常に含まれる", () => {
    const items = buildTrailingPeekItems({ workspaceLabel: "my-ws" }, ALL_ON);
    expect(items).toEqual([{ key: "workspace", text: "my-ws" }]);
  });

  it("isGitRepoでもhasSessionでもfilesが出る", () => {
    expect(buildTrailingPeekItems({ hasSession: true }, ALL_ON).some((i) => i.key === "files")).toBe(true);
    expect(buildTrailingPeekItems({ isGitRepo: true }, ALL_ON).some((i) => i.key === "files")).toBe(true);
    expect(buildTrailingPeekItems({}, ALL_ON).some((i) => i.key === "files")).toBe(false);
  });

  it("changesはisGitRepo && isDirtyの時だけ出て、text は F/+/- を含む", () => {
    const items = buildTrailingPeekItems(
      { isGitRepo: true, isDirty: true, changedFiles: 3, insertions: 10, deletions: 2 },
      ALL_ON,
    );
    expect(items.find((i) => i.key === "changes")).toEqual({ key: "changes", text: "3F +10 -2" });
    expect(buildTrailingPeekItems({ isGitRepo: true, isDirty: false }, ALL_ON).some((i) => i.key === "changes")).toBe(false);
  });

  it("branchはahead/behindを含む固定形式", () => {
    const items = buildTrailingPeekItems({ isGitRepo: true, branch: "main", ahead: 1, behind: 2 }, ALL_ON);
    expect(items.find((i) => i.key === "branch")).toEqual({ key: "branch", text: "main:1:2" });
  });

  it("prs/actions/devserverはそれぞれの値が無ければ出ない", () => {
    const empty = buildTrailingPeekItems({}, ALL_ON);
    expect(empty.some((i) => i.key === "prs")).toBe(false);
    expect(empty.some((i) => i.key === "actions")).toBe(false);
    expect(empty.some((i) => i.key === "devserver")).toBe(false);

    const filled = buildTrailingPeekItems(
      {
        branchPR: { number: 12, title: "Fix bug" },
        branchAction: { id: 9, status: "completed", conclusion: "success" },
        devServerEntry: { proxy_port: 3001 },
      },
      ALL_ON,
    );
    expect(filled.find((i) => i.key === "prs")).toEqual({ key: "prs", text: "12:Fix bug" });
    expect(filled.find((i) => i.key === "actions")).toEqual({ key: "actions", text: "9:completed:success" });
    expect(filled.find((i) => i.key === "devserver")).toEqual({ key: "devserver", text: "Server:3001" });
  });

  it("addはワークスペース未紐付け・セッションありの時だけ出る", () => {
    expect(buildTrailingPeekItems({ hasWorkspace: false, hasSession: true }, ALL_ON).some((i) => i.key === "add")).toBe(true);
    expect(buildTrailingPeekItems({ hasWorkspace: true, hasSession: true }, ALL_ON).some((i) => i.key === "add")).toBe(false);
  });

  it("dispatchは1件以上ある時だけ出て、idをカンマ結合する", () => {
    const items = buildTrailingPeekItems({ dispatchItems: [{ id: "d1" }, { id: "d2" }] }, ALL_ON);
    expect(items.find((i) => i.key === "dispatch")).toEqual({ key: "dispatch", text: "d1,d2" });
  });

  it("infoPillConfigでオフにしたキーは出ない", () => {
    const cfg = { ...ALL_ON, branch: false };
    const items = buildTrailingPeekItems({ isGitRepo: true, branch: "main" }, cfg);
    expect(items.some((i) => i.key === "branch")).toBe(false);
  });
});

describe("buildPeekText", () => {
  it("キーごとに固定/派生テキストを返す", () => {
    expect(buildPeekText("files", {})).toBe("Files");
    expect(buildPeekText("history", { lastCommitMessage: "fix: 直近の修正\n詳細" })).toBe("fix: 直近の修正");
    expect(buildPeekText("history", { lastCommitMessage: "" })).toBe("History");
    expect(buildPeekText("prs", { branchPR: { number: 5, title: "Add feature" } })).toBe("#5 Add feature");
    expect(buildPeekText("prs", {})).toBe("");
    expect(buildPeekText("actions", { branchAction: { name: "CI", status: "completed", conclusion: "success" } })).toBe("[CI] success");
    expect(buildPeekText("devserver", { devServerEntry: { proxy_port: 3000 } })).toBe("Dev Server :3000");
    expect(buildPeekText("devserver", {})).toBe("Server");
    expect(buildPeekText("devserver-stop", {})).toBe("Dev Server Stop");
    expect(buildPeekText("add", {})).toBe("Add");
    expect(buildPeekText("dispatch", { dispatchTooltip: "Run pending" })).toBe("Run pending");
    expect(buildPeekText("workspace", { workspaceLabel: "my-ws" })).toBe("my-ws");
    expect(buildPeekText("unknown-key", {})).toBe("");
  });
});

describe("buildPeekSignature", () => {
  it("peekingKeyが無ければnull", () => {
    expect(buildPeekSignature(null, {})).toBeNull();
  });

  it("changes/branchは専用フォーマット（buildPeekTextを経由しない）", () => {
    expect(buildPeekSignature("changes", { changedFiles: 2, insertions: 5, deletions: 1 })).toBe("changes:2:5:1");
    expect(buildPeekSignature("branch", { branch: "main", ahead: 1, behind: 0 })).toBe("branch:main:1:0");
  });

  it("それ以外はkey:buildPeekText(...)の形式", () => {
    expect(buildPeekSignature("files", {})).toBe("files:Files");
    expect(buildPeekSignature("workspace", { workspaceLabel: "my-ws" })).toBe("workspace:my-ws");
  });
});
