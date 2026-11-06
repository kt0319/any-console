import { describe, it, expect, vi } from "vitest";
import { confirmCloseTab } from "../../ui/utils/tab-close-confirm.ts";

describe("confirmCloseTab", () => {
  it("通常のタブは Detach のみを追加選択肢に出す", async () => {
    const confirm = vi.fn(async () => true);
    await confirmCloseTab(confirm, { workspace: "ws1" });
    const opts = confirm.mock.calls[0][1];
    expect(opts.extra.value).toBe("detach");
    expect(opts.extra2).toBeUndefined();
  });

  it("canRemoveWorktree のとき worktree 削除の選択肢を足す", async () => {
    const confirm = vi.fn(async () => "worktree");
    const result = await confirmCloseTab(confirm, { workspace: "ws1:feat" }, true);
    expect(confirm.mock.calls[0][1].extra2.value).toBe("worktree");
    expect(result).toBe("worktree");
  });
});
