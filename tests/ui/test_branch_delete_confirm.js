import { describe, it, expect, vi } from "vitest";
import { confirmDeleteBranch } from "../../ui/utils/branch-delete-confirm.ts";

function fakeConfirm(result) {
  const confirm = vi.fn().mockResolvedValue(result);
  return confirm;
}

describe("confirmDeleteBranch", () => {
  it("worktreeDesc未指定時はLocal only/Local + remote/Cancelの3択のみ出す（Remove worktreeは出さない）", async () => {
    const confirm = fakeConfirm(true);
    await confirmDeleteBranch(confirm, { name: "feature/x" });

    expect(confirm.mock.calls[0][0]).toBe('Delete branch "feature/x"? This cannot be undone.');
    const opts = confirm.mock.calls[0][1];
    expect(opts.ok).toEqual({ label: "Local only", icon: "mdi-delete", danger: true });
    expect(opts.extra.label).toBe("Local + remote");
    expect(opts.extra.value).toBe("remote");
    expect(opts.extra2).toBeUndefined();
  });

  it("worktreeDesc指定時はRemove worktree選択肢も出す", async () => {
    const confirm = fakeConfirm(true);
    await confirmDeleteBranch(confirm, { name: "feature/x" }, { worktreeDesc: "The working tree directory will be deleted." });

    const opts = confirm.mock.calls[0][1];
    expect(opts.extra2).toEqual({
      label: "Remove worktree",
      value: "worktree",
      icon: "mdi-file-tree",
      desc: "The working tree directory will be deleted.",
    });
  });

  it("confirmの戻り値をそのまま返す", async () => {
    const confirm = fakeConfirm("remote");
    await expect(confirmDeleteBranch(confirm, { name: "feature/x" })).resolves.toBe("remote");
  });
});
