// @ts-check
import { describe, it, expect } from "vitest";
import { ref } from "vue";
import { useWorkspaceGitStatus } from "../../ui/composables/useWorkspaceGitStatus.js";

function make(wsValue) {
  return useWorkspaceGitStatus(ref(wsValue));
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
  });

  it("treats missing upstream flag as true (optimistic)", () => {
    const s = make({ branch: "main" });
    expect(s.hasUpstream.value).toBe(true);
  });

  it("detects upstream absence when explicitly false", () => {
    const s = make({ has_upstream: false });
    expect(s.hasUpstream.value).toBe(false);
  });

  it("isGitRepo only when is_git_repo === true", () => {
    expect(make({ is_git_repo: true }).isGitRepo.value).toBe(true);
    expect(make({ is_git_repo: false }).isGitRepo.value).toBe(false);
    expect(make({}).isGitRepo.value).toBe(false);
  });

  it("isDirty only when clean === false", () => {
    expect(make({ clean: false }).isDirty.value).toBe(true);
    expect(make({ clean: true }).isDirty.value).toBe(false);
    expect(make(undefined).isDirty.value).toBeFalsy();
  });

  it("exposes ahead/behind and numstat counts", () => {
    const s = make({ ahead: 2, behind: 1, changed_files: 3, insertions: 10, deletions: 4 });
    expect(s.ahead.value).toBe(2);
    expect(s.behind.value).toBe(1);
    expect(s.changedFiles.value).toBe(3);
    expect(s.insertions.value).toBe(10);
    expect(s.deletions.value).toBe(4);
  });
});
