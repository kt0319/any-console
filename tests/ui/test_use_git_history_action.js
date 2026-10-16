// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiWithPeekMock = vi.fn(async () => true);

vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({
    apiWithPeek: apiWithPeekMock,
    wsEndpoint: (ws, action) => `/workspaces/${ws}/${action}`,
  }),
}));
vi.mock("../../ui/composables/useWorkspace.ts", () => ({
  useWorkspace: () => ({ withWorkspace: async (fn) => fn("ws1") }),
}));
vi.mock("../../ui/composables/useConfirm.ts", () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock("../../ui/composables/usePrompt.ts", () => ({
  usePrompt: () => ({ prompt: vi.fn(async () => "feature/x") }),
}));

import { useGitHistoryAction } from "../../ui/composables/useGitHistoryAction.ts";

const entry = { hash: "abc1234", fullHash: "abc1234full" };

describe("useGitHistoryAction: 完了通知はpeekで出す", () => {
  beforeEach(() => apiWithPeekMock.mockClear());

  it("cherry-pick等はアクション名とshort hashを渡す", async () => {
    await useGitHistoryAction().execAction("cherry-pick", entry);
    expect(apiWithPeekMock).toHaveBeenCalledWith(
      "/workspaces/ws1/cherry-pick",
      { commit_hash: "abc1234full" },
      { wsName: "ws1", headline: "cherry-pick done", detail: "abc1234", errorMessage: "cherry-pick failed" },
    );
  });

  it("merge / rebase / create-branch の見出しと補足", async () => {
    const { execMerge, execRebase, execCreateBranch } = useGitHistoryAction();
    await execMerge("dev");
    await execRebase("dev");
    await execCreateBranch(entry);
    const calls = apiWithPeekMock.mock.calls.map(([endpoint, , opts]) => [endpoint, opts.headline, opts.detail]);
    expect(calls).toEqual([
      ["/workspaces/ws1/merge", "Merged", "dev"],
      ["/workspaces/ws1/rebase", "Rebased", "onto dev"],
      ["/workspaces/ws1/create-branch", "Branch created", "feature/x"],
    ]);
  });
});
