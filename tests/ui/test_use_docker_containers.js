// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiGetMock = vi.fn();

vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({ apiGet: apiGetMock }),
}));

async function freshModule() {
  vi.resetModules();
  return import("../../ui/composables/useDockerContainers.ts");
}

beforeEach(() => {
  apiGetMock.mockReset();
});

describe("useDockerContainers: fetchContainers の同時呼び出しをまとめる", () => {
  it("複数箇所から同時にfetchContainersを呼んでもリクエストは1回だけ", async () => {
    let resolveApiGet;
    apiGetMock.mockReturnValue(
      new Promise((resolve) => { resolveApiGet = resolve; }),
    );
    const { useDockerContainers } = await freshModule();
    const a = useDockerContainers();
    const b = useDockerContainers();

    const p1 = a.fetchContainers();
    const p2 = b.fetchContainers();
    resolveApiGet({ ok: true, data: [{ workspace: "ws1", state: "running", name: "web-1" }] });
    await Promise.all([p1, p2]);

    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(a.containers.value).toEqual([{ workspace: "ws1", state: "running", name: "web-1" }]);
  });

  it("先のfetchが完了した後は、次のfetchContainersで新たにリクエストする", async () => {
    apiGetMock.mockResolvedValue({ ok: true, data: [] });
    const { useDockerContainers } = await freshModule();
    const { fetchContainers } = useDockerContainers();

    await fetchContainers();
    await fetchContainers();

    expect(apiGetMock).toHaveBeenCalledTimes(2);
  });

  it("start()の初回fetchと直後の明示的なfetchContainers呼び出しも1リクエストにまとまる", async () => {
    let resolveApiGet;
    apiGetMock.mockReturnValue(
      new Promise((resolve) => { resolveApiGet = resolve; }),
    );
    const { useDockerContainers } = await freshModule();
    const { start, fetchContainers } = useDockerContainers();

    start();
    const p = fetchContainers();
    resolveApiGet({ ok: true, data: [] });
    await p;

    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });
});
