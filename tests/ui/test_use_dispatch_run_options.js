// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextTick, ref } from "vue";

const apiGetMock = vi.fn();

vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({ apiGet: apiGetMock, wsEndpoint: (ws, path) => `/workspaces/${ws}/${path}` }),
}));

const { useDispatchRunOptions } = await import("../../ui/composables/useDispatchRunOptions.ts");

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

async function flush() {
  for (let i = 0; i < 5; i++) await nextTick();
}

function setup({ jobWorkspace = "", selectedJob = "terminal", branchWorkspace = "", baseBranch = "" } = {}) {
  const refs = {
    jobWorkspace: ref(jobWorkspace),
    selectedJob: ref(selectedJob),
    branchWorkspace: ref(branchWorkspace),
    baseBranch: ref(baseBranch),
  };
  return { refs, options: useDispatchRunOptions(refs) };
}

beforeEach(() => {
  apiGetMock.mockReset();
});

describe("useDispatchRunOptions", () => {
  it("ワークスペース未選択なら取得せず空の選択肢でready", () => {
    const { options } = setup();
    expect(apiGetMock).not.toHaveBeenCalled();
    expect(options.jobsState.value.status).toBe("ready");
    expect(options.jobs.value).toEqual([]);
    expect(options.localBranches.value).toEqual([]);
  });

  it("Job一覧を取得し、選択中Jobが無ければterminalに戻す", async () => {
    apiGetMock.mockImplementation(async (endpoint) => (endpoint.endsWith("/jobs")
      ? { ok: true, data: { build: { label: "Build" }, test: {} } }
      : { ok: true, data: [] }));
    const { refs, options } = setup({ jobWorkspace: "app", selectedJob: "deploy" });
    await flush();
    expect(options.jobs.value).toEqual([{ key: "build", label: "Build" }, { key: "test", label: "test" }]);
    expect(refs.selectedJob.value).toBe("terminal");
  });

  it("ブランチ一覧は現在ブランチを先頭にし、無いBase branchは空に戻す", async () => {
    apiGetMock.mockResolvedValue({ ok: true, data: [{ name: "dev" }, { name: "main", current: true }] });
    const { refs, options } = setup({ branchWorkspace: "app", baseBranch: "gone" });
    await flush();
    expect(options.localBranches.value).toEqual(["main", "dev"]);
    expect(refs.baseBranch.value).toBe("");
  });

  it("ワークスペースを切り替えた後に届いた古いJob一覧の応答で上書きしない", async () => {
    const jobsA = deferred();
    const jobsB = deferred();
    apiGetMock.mockImplementation((endpoint) => {
      if (endpoint === "/workspaces/a/jobs") return jobsA.promise;
      if (endpoint === "/workspaces/b/jobs") return jobsB.promise;
      return Promise.resolve({ ok: true, data: [] });
    });
    const { refs, options } = setup({ jobWorkspace: "a", selectedJob: "deploy" });
    refs.jobWorkspace.value = "b";
    await flush();

    jobsB.resolve({ ok: true, data: { deploy: { label: "Deploy" } } });
    await flush();
    jobsA.resolve({ ok: true, data: { lint: {} } });
    await flush();

    expect(options.jobs.value).toEqual([{ key: "deploy", label: "Deploy" }]);
    expect(refs.selectedJob.value).toBe("deploy");
  });

  it("ワークスペースを切り替えた後に届いた古いブランチ一覧の応答で上書きしない", async () => {
    const branchesA = deferred();
    const branchesB = deferred();
    apiGetMock.mockImplementation((endpoint) => {
      if (endpoint === "/workspaces/a/branches") return branchesA.promise;
      if (endpoint === "/workspaces/b/branches") return branchesB.promise;
      return Promise.resolve({ ok: true, data: {} });
    });
    const { refs, options } = setup({ branchWorkspace: "a", baseBranch: "feature" });
    refs.branchWorkspace.value = "b";
    await flush();

    branchesB.resolve({ ok: true, data: [{ name: "feature", current: true }] });
    await flush();
    branchesA.resolve({ ok: true, data: [{ name: "main", current: true }] });
    await flush();

    expect(options.localBranches.value).toEqual(["feature"]);
    expect(refs.baseBranch.value).toBe("feature");
  });

  it("取得失敗はerror状態にする", async () => {
    apiGetMock.mockResolvedValue({ ok: false, data: null });
    const { options } = setup({ jobWorkspace: "app", branchWorkspace: "app" });
    await flush();
    expect(options.jobsState.value.status).toBe("error");
    expect(options.branchesState.value.status).toBe("error");
  });
});
