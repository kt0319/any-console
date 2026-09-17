// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EP_DOCKER_CONTAINERS, EP_PREVIEW_PORTS } from "../../ui/utils/endpoints.ts";

const apiGetMock = vi.fn();

vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({ apiGet: apiGetMock }),
}));

const INTERVAL_MS = 1000;

async function freshPoll() {
  vi.resetModules();
  const { createSharedResourcePoll } = await import("../../ui/composables/useSharedResourcePoll.ts");
  return createSharedResourcePoll({ endpoint: "/test/items", intervalMs: INTERVAL_MS });
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  apiGetMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSharedResourcePoll: fetchItems の同時呼び出しをまとめる", () => {
  it("複数箇所から同時にfetchItemsを呼んでもリクエストは1回だけで、結果は共有される", async () => {
    const d = deferred();
    apiGetMock.mockReturnValue(d.promise);
    const usePoll = await freshPoll();
    const a = usePoll();
    const b = usePoll();

    const p1 = a.fetchItems();
    const p2 = b.fetchItems();
    d.resolve({ ok: true, data: [{ name: "x" }] });
    await Promise.all([p1, p2]);

    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(apiGetMock).toHaveBeenCalledWith("/test/items");
    expect(b.items.value).toEqual([{ name: "x" }]);
  });

  it("先のfetchが完了した後は、次のfetchItemsで新たにリクエストする", async () => {
    apiGetMock.mockResolvedValue({ ok: true, data: [] });
    const { fetchItems } = (await freshPoll())();

    await fetchItems();
    await fetchItems();

    expect(apiGetMock).toHaveBeenCalledTimes(2);
  });

  it("start()の初回fetchと直後の明示的なfetchItems呼び出しも1リクエストにまとまる", async () => {
    const d = deferred();
    apiGetMock.mockReturnValue(d.promise);
    const { start, stop, fetchItems } = (await freshPoll())();

    start();
    const p = fetchItems();
    d.resolve({ ok: true, data: [] });
    await p;
    stop();

    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });

  it("取得失敗・配列以外のレスポンスでは既存の結果を潰さない", async () => {
    const { items, fetchItems } = (await freshPoll())();
    apiGetMock.mockResolvedValueOnce({ ok: true, data: [{ name: "keep" }] });
    await fetchItems();
    apiGetMock.mockResolvedValueOnce({ ok: false, data: null });
    await fetchItems();
    apiGetMock.mockResolvedValueOnce({ ok: true, data: { not: "array" } });
    await fetchItems();

    expect(items.value).toEqual([{ name: "keep" }]);
  });
});

describe("createSharedResourcePoll: 参照カウント付きの単一タイマー", () => {
  it("複数のstartでもタイマーは1本で、全員がstopするまで止まらない", async () => {
    vi.useFakeTimers();
    apiGetMock.mockResolvedValue({ ok: true, data: [] });
    const usePoll = await freshPoll();
    const a = usePoll();
    const b = usePoll();

    a.start();
    b.start();
    expect(apiGetMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(apiGetMock).toHaveBeenCalledTimes(2);

    a.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(apiGetMock).toHaveBeenCalledTimes(3);

    b.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(apiGetMock).toHaveBeenCalledTimes(3);
  });

  it("同じインスタンスのstart/stopは冪等で、二重stopが他の購読者のタイマーを止めない", async () => {
    vi.useFakeTimers();
    apiGetMock.mockResolvedValue({ ok: true, data: [] });
    const usePoll = await freshPoll();
    const a = usePoll();
    const b = usePoll();

    a.start();
    a.start();
    b.start();
    b.stop();
    b.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(apiGetMock).toHaveBeenCalledTimes(2);

    a.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(apiGetMock).toHaveBeenCalledTimes(2);
  });

  it("ページ非表示中のtickではリクエストしない", async () => {
    vi.useFakeTimers();
    apiGetMock.mockResolvedValue({ ok: true, data: [] });
    const { start, stop } = (await freshPoll())();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);

    start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    stop();
    hidden.mockRestore();

    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });
});

describe("共通ポーリングのラッパー", () => {
  it.each([
    ["usePreviewPorts", EP_PREVIEW_PORTS, "ports", "fetchPorts"],
    ["useDockerContainers", EP_DOCKER_CONTAINERS, "containers", "fetchContainers"],
  ])("%s は自分のエンドポイントを取得し、既存の戻り値名で公開する", async (name, endpoint, itemsKey, fetchKey) => {
    vi.resetModules();
    apiGetMock.mockResolvedValue({ ok: true, data: [{ id: 1 }] });
    const mod = await import(`../../ui/composables/${name}.ts`);
    const result = mod[name]();

    await result[fetchKey]();

    expect(apiGetMock).toHaveBeenCalledWith(endpoint);
    expect(result[itemsKey].value).toEqual([{ id: 1 }]);
    expect(typeof result.start).toBe("function");
    expect(typeof result.stop).toBe("function");
  });
});
