// @ts-check
import { describe, it, expect } from "vitest";
import { DEFAULT_PANE, isDeepLinkablePane, paneRequiresGit, resolvePaneKey } from "../../ui/utils/workspace-panes.ts";

// 集約前に WorkspaceDetail.vue / useDeepLink.ts へ分散していた定義と同じ判定になることを固定する。
const LEGACY_VALID_PANE_KEYS = ["jobs", "files", "history", "changes", "issues", "actions", "docker", "prs", "dispatch", "select"];
const LEGACY_GIT_ONLY = ["jobs", "history", "changes", "branch", "stash", "issues", "actions", "prs"];
const LEGACY_DEEP_LINKABLE = ["history", "files", "changes", "branch", "jobs", "stash", "issues", "actions", "prs"];
const ALL_KEYS = [...new Set([...LEGACY_VALID_PANE_KEYS, ...LEGACY_GIT_ONLY, ...LEGACY_DEEP_LINKABLE, "unknown", ""])];

describe("workspace-panes", () => {
  it("正当なペイン名はそのまま、旧名は統合先へ、未知のキーはjobsへ解決する", () => {
    for (const key of LEGACY_VALID_PANE_KEYS) expect(resolvePaneKey(key)).toBe(key);
    expect(resolvePaneKey("branch")).toBe("history");
    expect(resolvePaneKey("stash")).toBe("changes");
    expect(resolvePaneKey("unknown")).toBe(DEFAULT_PANE);
    expect(resolvePaneKey("toString")).toBe(DEFAULT_PANE);
    expect(DEFAULT_PANE).toBe("jobs");
  });

  it("git必須の判定は集約前のgitOnlyPanesと一致する", () => {
    for (const key of ALL_KEYS) expect(paneRequiresGit(key)).toBe(LEGACY_GIT_ONLY.includes(key));
  });

  it("ディープリンク可否は集約前のVALID_PANESと一致する", () => {
    for (const key of ALL_KEYS) expect(isDeepLinkablePane(key)).toBe(LEGACY_DEEP_LINKABLE.includes(key));
  });
});
