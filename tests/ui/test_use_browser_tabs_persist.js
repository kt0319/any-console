// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { nextTick } from "vue";
import { LAYOUT_SAVE_DEBOUNCE_MS } from "../../ui/utils/constants.ts";

const apiFetchMock = vi.fn();

vi.mock("../../ui/stores/auth.ts", () => ({
  useAuthStore: () => ({ apiFetch: apiFetchMock }),
}));

import { useBrowserTabsPersist } from "../../ui/composables/useBrowserTabsPersist.ts";
import { useBrowserTabStore } from "../../ui/stores/browserTabs.ts";

function okResponse(data) {
  return { ok: true, json: async () => data };
}

/** watch発火（nextTick）→ debounceタイマー消化までを進める。 */
async function flushSave() {
  await nextTick();
  await vi.advanceTimersByTimeAsync(LAYOUT_SAVE_DEBOUNCE_MS + 10);
}

describe("useBrowserTabsPersist", () => {
  let store;

  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    store = useBrowserTabStore();
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("復元成功後のタブ変化をdebounceしてPUTする", async () => {
    apiFetchMock.mockResolvedValueOnce(
      okResponse({ tabs: [{ url: "http://localhost:3000/" }], activeUrl: "http://localhost:3000/" }),
    );
    const { restoreBrowserTabs, startWatching } = useBrowserTabsPersist();
    await restoreBrowserTabs();
    expect(store.isRestored).toBe(true);
    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:3000/"]);
    expect(store.activeBrowserTabId).toBe(store.tabs[0].id);

    startWatching();
    apiFetchMock.mockResolvedValue(okResponse({ status: "ok" }));
    store.openBrowserTab("http://localhost:4000/");
    await flushSave();

    const putCalls = apiFetchMock.mock.calls.filter(([, opts]) => opts?.method === "PUT");
    expect(putCalls.length).toBe(1);
    expect(putCalls[0][1].body).toEqual({
      tabs: [{ url: "http://localhost:3000/" }, { url: "http://localhost:4000/" }],
      activeUrl: "http://localhost:4000/",
    });
  });

  it("復元GETが失敗（non-ok）したセッションでは保存を走らせない（保存済み一覧の上書き消去を防ぐ）", async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: false });
    const { restoreBrowserTabs, startWatching } = useBrowserTabsPersist();
    await restoreBrowserTabs();
    expect(store.isRestored).toBe(false);

    startWatching();
    store.openBrowserTab("http://localhost:3000/");
    await flushSave();

    const putCalls = apiFetchMock.mock.calls.filter(([, opts]) => opts?.method === "PUT");
    expect(putCalls.length).toBe(0);
  });

  it("復元GETが例外を投げた場合も isRestored は立たず保存しない", async () => {
    apiFetchMock.mockRejectedValueOnce(new Error("network"));
    const { restoreBrowserTabs, startWatching } = useBrowserTabsPersist();
    await restoreBrowserTabs();
    expect(store.isRestored).toBe(false);

    startWatching();
    store.openBrowserTab("http://localhost:3000/");
    await flushSave();

    const putCalls = apiFetchMock.mock.calls.filter(([, opts]) => opts?.method === "PUT");
    expect(putCalls.length).toBe(0);
  });

  it("復元時に http/https 以外のURL（手編集されたconfig等）を除外する", async () => {
    apiFetchMock.mockResolvedValueOnce(
      okResponse({
        tabs: [{ url: "http://localhost:3000/" }, { url: "javascript:alert(1)" }, {}],
        activeUrl: "javascript:alert(1)",
      }),
    );
    const { restoreBrowserTabs } = useBrowserTabsPersist();
    await restoreBrowserTabs();

    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:3000/"]);
    // 除外されたURLがactiveUrlでも、突き合わせに失敗してnullへ落ちるだけで壊れない
    expect(store.activeBrowserTabId).toBe(null);
    expect(store.isRestored).toBe(true);
  });
});
