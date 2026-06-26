// @ts-check
import { describe, it, expect } from "vitest";
import { ref } from "vue";
import { useWorkspaceGitStatus } from "../../ui/composables/useWorkspaceGitStatus.js";

function make(wsValue, mobile = false) {
  return useWorkspaceGitStatus(ref(wsValue), ref(mobile));
}

describe("useWorkspaceGitStatus", () => {
  it("returns safe defaults when ws is undefined", () => {
    const s = make(undefined);
    expect(s.isGitRepo.value).toBe(false);
    expect(s.ahead.value).toBe(0);
    expect(s.behind.value).toBe(0);
    expect(s.changedFiles.value).toBe(0);
    expect(s.insertions.value).toBe(0);
    expect(s.deletions.value).toBe(0);
    expect(s.msgText.value).toBe("");
  });

  it("treats missing upstream/remote flags as true (optimistic)", () => {
    const s = make({ branch: "main" });
    expect(s.hasUpstream.value).toBe(true);
    expect(s.hasRemoteBranch.value).toBe(true);
  });

  it("detects upstream/remote absence when explicitly false", () => {
    const s = make({ has_upstream: false, has_remote_branch: false });
    expect(s.hasUpstream.value).toBe(false);
    expect(s.hasRemoteBranch.value).toBe(false);
  });

  it("hasGitActions is true when ahead/behind/no-upstream", () => {
    expect(make({ ahead: 2 }).hasGitActions.value).toBe(true);
    expect(make({ behind: 1 }).hasGitActions.value).toBe(true);
    expect(make({ has_upstream: false }).hasGitActions.value).toBe(true);
    expect(make({ ahead: 0, behind: 0, has_upstream: true }).hasGitActions.value).toBe(false);
  });

  it("isDirty only when clean === false", () => {
    expect(make({ clean: false }).isDirty.value).toBe(true);
    expect(make({ clean: true }).isDirty.value).toBe(false);
    expect(make(undefined).isDirty.value).toBeFalsy();
  });

  it("statusLoading while last_commit_message is undefined, and msgText shows Loading", () => {
    const s = make({ branch: "main" });
    expect(s.statusLoading.value).toBe(true);
    expect(s.msgText.value).toBe("Loading");
  });

  it("msgText returns the commit message once loaded", () => {
    const s = make({ last_commit_message: "fix: bug" });
    expect(s.statusLoading.value).toBe(false);
    expect(s.msgText.value).toBe("fix: bug");
  });

  it("branchParts is the raw branch on desktop", () => {
    const s = make({ branch: "feature/long-branch-name" }, false);
    expect(s.branchParts.value).toEqual({ abbr: "", rest: "feature/long-branch-name" });
    expect(s.isBranchLong.value).toBe(false);
  });

  it("branchParts abbreviates/truncates on mobile and flags long branches", () => {
    const s = make({ branch: "feature/some-really-long-branch" }, true);
    expect(s.branchParts.value.rest.length).toBeLessThanOrEqual(16);
    expect(s.isBranchLong.value).toBe(true);
  });
});
