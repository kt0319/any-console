import { describe, it, expect } from "vitest";
import { buildActionSummary } from "../../ui/utils/actionSummary.js";

describe("buildActionSummary", () => {
  it("titleと改行+空行を必ず含める", () => {
    const out = buildActionSummary({ title: "Run?" });
    expect(out.startsWith("Run?\n\n")).toBe(true);
  });

  it("workspace/session/pane を含める", () => {
    const out = buildActionSummary({ title: "T", workspace: "ws-a", session: "abc", pane: "files" });
    expect(out).toContain("Workspace: ws-a");
    expect(out).toContain("Session: abc");
    expect(out).toContain("Pane: files");
  });

  it("job=terminal は省略する", () => {
    const out = buildActionSummary({ title: "T", workspace: "ws", job: "terminal" });
    expect(out).not.toContain("Job:");
  });

  it("job が terminal 以外なら表示する", () => {
    const out = buildActionSummary({ title: "T", workspace: "ws", job: "claude" });
    expect(out).toContain("Job: claude");
  });

  it("branchStatus=current は (already current)", () => {
    const out = buildActionSummary({ title: "T", branch: "main", branchStatus: "current" });
    expect(out).toContain("Branch: main (already current)");
  });

  it("branchStatus=exists は (checkout)", () => {
    const out = buildActionSummary({ title: "T", branch: "dev", branchStatus: "exists" });
    expect(out).toContain("Branch: dev (checkout)");
  });

  it("branchStatus=missing + baseBranch は (new from \"...\")", () => {
    const out = buildActionSummary({ title: "T", branch: "feat", branchStatus: "missing", baseBranch: "main" });
    expect(out).toContain('Branch: feat (new from "main")');
  });

  it("branchStatus=missing + createBranch は (new branch)", () => {
    const out = buildActionSummary({ title: "T", branch: "feat", branchStatus: "missing", createBranch: true });
    expect(out).toContain("Branch: feat (new branch)");
  });

  it("branchStatus=missing + createBranch=false は失敗予告", () => {
    const out = buildActionSummary({ title: "T", branch: "feat", branchStatus: "missing", createBranch: false });
    expect(out).toContain("does not exist");
  });

  it("branchStatus=unknown + createBranch は (create if missing)", () => {
    const out = buildActionSummary({ title: "T", branch: "x", branchStatus: "unknown", createBranch: true });
    expect(out).toContain("(create if missing)");
  });

  it("branchStatus 未指定 + branch のみは note なし", () => {
    const out = buildActionSummary({ title: "T", branch: "x" });
    expect(out).toMatch(/Branch: x$/m);
  });

  it("text は 80文字以内ならそのまま", () => {
    const out = buildActionSummary({ title: "T", text: "hello world" });
    expect(out).toContain("Input: hello world");
  });

  it("text が長い時は省略する", () => {
    const long = "a".repeat(120);
    const out = buildActionSummary({ title: "T", text: long });
    expect(out).toContain("…");
  });

  it("text が空文字なら (no input)", () => {
    const out = buildActionSummary({ title: "T", text: "" });
    expect(out).not.toContain("Input:");
  });

  it("text 内の連続空白は単一スペースに正規化", () => {
    const out = buildActionSummary({ title: "T", text: "a  \n\t b" });
    expect(out).toContain("Input: a b");
  });

  it("workspace 等が空なら行が出ない", () => {
    const out = buildActionSummary({ title: "Bare" });
    expect(out).toBe("Bare\n\n");
  });
});
