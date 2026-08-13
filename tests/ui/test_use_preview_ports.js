// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiGetMock = vi.fn();

vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({ apiGet: apiGetMock }),
}));

async function freshModule() {
  vi.resetModules();
  return import("../../ui/composables/usePreviewPorts.ts");
}

beforeEach(() => {
  apiGetMock.mockReset();
});

describe("usePreviewPorts: fetchPorts の同時呼び出しをまとめる", () => {
  it("複数箇所から同時にfetchPortsを呼んでもリクエストは1回だけ", async () => {
    let resolveApiGet;
    apiGetMock.mockReturnValue(
      new Promise((resolve) => { resolveApiGet = resolve; }),
    );
    const { usePreviewPorts } = await freshModule();
    const a = usePreviewPorts();
    const b = usePreviewPorts();

    const p1 = a.fetchPorts();
    const p2 = b.fetchPorts();
    resolveApiGet({ ok: true, data: [{ workspace: "ws1", proxy_port: 3000 }] });
    await Promise.all([p1, p2]);

    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(a.ports.value).toEqual([{ workspace: "ws1", proxy_port: 3000 }]);
  });

  it("先のfetchが完了した後は、次のfetchPortsで新たにリクエストする", async () => {
    apiGetMock.mockResolvedValue({ ok: true, data: [] });
    const { usePreviewPorts } = await freshModule();
    const { fetchPorts } = usePreviewPorts();

    await fetchPorts();
    await fetchPorts();

    expect(apiGetMock).toHaveBeenCalledTimes(2);
  });

  it("start()の初回fetchと直後の明示的なfetchPorts呼び出しも1リクエストにまとまる", async () => {
    let resolveApiGet;
    apiGetMock.mockReturnValue(
      new Promise((resolve) => { resolveApiGet = resolve; }),
    );
    const { usePreviewPorts } = await freshModule();
    const { start, fetchPorts } = usePreviewPorts();

    start();
    const p = fetchPorts();
    resolveApiGet({ ok: true, data: [] });
    await p;

    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });
});
