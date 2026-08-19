import { describe, it, expect } from "vitest";
import {
  ADD_PILL_TOOLTIP,
  actionsTooltip,
  branchTooltip,
  buildInfoPillTooltips,
  changesTooltip,
  devServerTooltip,
  dispatchTooltip,
  filesTooltip,
  prsTooltip,
} from "../../ui/utils/info-pill-tooltips.ts";

describe("buildInfoPillTooltips", () => {
  it("既定値（すべて未指定）でも全キーの文言を返す", () => {
    const tooltips = buildInfoPillTooltips({});
    expect(Object.keys(tooltips).sort()).toEqual([
      "actions", "add", "branch", "changes", "devserver", "dispatch", "files", "prs",
    ]);
    expect(tooltips.branch).toBe("Branches: ");
    expect(tooltips.devserver).toBe("Dev Server");
    expect(tooltips.prs).toBe("GitHub PRs");
    expect(tooltips.actions).toBe("GitHub Actions");
    expect(tooltips.dispatch).toBe("Dispatch");
    expect(tooltips.add).toBe(ADD_PILL_TOOLTIP);
  });

  it("各キーの文言は単体のツールチップ関数と一致する", () => {
    const data = {
      name: "myproject",
      isGitRepo: true,
      branch: "main",
      ahead: 2,
      behind: 1,
      hasUpstream: true,
      changedFiles: 3,
      insertions: 10,
      deletions: 4,
      lastCommitMessage: "feat: 追加\n\n本文",
      devServerEntry: { scheme: "http", proxy_port: 25173 },
      hostname: "host.example",
      dispatchItems: [{ request: { job: "build" } }],
      branchPR: { number: 7, title: "My PR" },
      branchAction: { name: "CI", status: "in_progress", conclusion: null },
    };
    const tooltips = buildInfoPillTooltips(data);
    expect(tooltips.files).toBe(filesTooltip({ name: "myproject", isGitRepo: true }));
    expect(tooltips.changes).toBe(changesTooltip({ changedFiles: 3, insertions: 10, deletions: 4 }));
    expect(tooltips.branch).toBe(branchTooltip({ branch: "main", ahead: 2, behind: 1, hasUpstream: true, lastCommitMessage: data.lastCommitMessage }));
    expect(tooltips.devserver).toBe(devServerTooltip(data.devServerEntry, "host.example"));
    expect(tooltips.dispatch).toBe(dispatchTooltip(data.dispatchItems));
    expect(tooltips.prs).toBe(prsTooltip(data.branchPR));
    expect(tooltips.actions).toBe(actionsTooltip(data.branchAction));
    expect(tooltips.branch).toContain("main");
    expect(tooltips.prs).toContain("#7");
  });
});

describe("branchTooltip", () => {
  it("最終コミットの1行目をブランチ表記に併記する", () => {
    expect(branchTooltip({ branch: "main", lastCommitMessage: "feat: 追加\n\n本文" }))
      .toBe("Branches: main  ·  feat: 追加");
  });

  it("最終コミット未取得時は従来どおりブランチ表記のみ", () => {
    expect(branchTooltip({ branch: "main" })).toBe("Branches: main");
  });
});
