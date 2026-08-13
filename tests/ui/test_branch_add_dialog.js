// @ts-check
import { describe, it, expect, vi } from "vitest";
import { useBranchAddDialog } from "../../ui/composables/useBranchAddDialog.ts";

function setup() {
  const createBranch = vi.fn();
  const createWorktree = vi.fn();
  const dialog = useBranchAddDialog({ createBranch, createWorktree });
  return { ...dialog, createBranch, createWorktree };
}

describe("useBranchAddDialog", () => {
  it("starts closed with default type", () => {
    const d = setup();
    expect(d.addModalOpen.value).toBe(false);
    expect(d.addType.value).toBe("branch");
    expect(d.addName.value).toBe("");
  });

  it("openAddModal resets state and opens", () => {
    const d = setup();
    d.addName.value = "leftover";
    d.addType.value = "worktree";
    d.openAddModal();
    expect(d.addModalOpen.value).toBe(true);
    expect(d.addType.value).toBe("branch");
    expect(d.addName.value).toBe("");
  });

  it("closeAddModal closes the dialog", () => {
    const d = setup();
    d.openAddModal();
    d.closeAddModal();
    expect(d.addModalOpen.value).toBe(false);
  });

  it("submit with branch type calls createBranch with trimmed name and closes", async () => {
    const d = setup();
    d.openAddModal();
    d.addName.value = "  feature/x  ";
    await d.submitAddModal();
    expect(d.createBranch).toHaveBeenCalledWith("feature/x");
    expect(d.createWorktree).not.toHaveBeenCalled();
    expect(d.addModalOpen.value).toBe(false);
  });

  it("submit with worktree type calls createWorktree", async () => {
    const d = setup();
    d.addType.value = "worktree";
    d.addName.value = "wt-branch";
    await d.submitAddModal();
    expect(d.createWorktree).toHaveBeenCalledWith("wt-branch");
    expect(d.createBranch).not.toHaveBeenCalled();
  });

  it("submit with empty name is a no-op (stays open, no action)", async () => {
    const d = setup();
    d.openAddModal();
    d.addName.value = "   ";
    await d.submitAddModal();
    expect(d.createBranch).not.toHaveBeenCalled();
    expect(d.createWorktree).not.toHaveBeenCalled();
    expect(d.addModalOpen.value).toBe(true);
  });
});
