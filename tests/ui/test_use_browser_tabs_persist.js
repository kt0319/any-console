// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { nextTick } from "vue";
import { BROWSER_TABS_RESTORE_RETRY_MS, LAYOUT_SAVE_DEBOUNCE_MS } from "../../ui/utils/constants.ts";
import { emit } from "../../ui/app-bridge.ts";

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

/** async ハンドラ（apiFetch → res.json のチェーン）のマイクロタスクを消化する。 */
async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function putCalls() {
  return apiFetchMock.mock.calls.filter(([, opts]) => opts?.method === "PUT");
}

describe("useBrowserTabsPersist", () => {
  let store;
  // startWatching は watch と connectivity:back 購読を登録する。テスト間で
  // 古いストアに紐付いたリスナーが残らないよう、返り値のクリーンアップを
  // 必ず afterEach で呼ぶ。
  let cleanups;

  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    store = useBrowserTabStore();
    apiFetchMock.mockReset();
    cleanups = [];
  });

  afterEach(() => {
    for (const fn of cleanups) fn();
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

    cleanups.push(startWatching());
    apiFetchMock.mockResolvedValue(okResponse({ status: "ok" }));
    store.openBrowserTab("http://localhost:4000/");
    await flushSave();

    expect(putCalls().length).toBe(1);
    expect(putCalls()[0][1].body).toEqual({
      tabs: [{ url: "http://localhost:3000/" }, { url: "http://localhost:4000/" }],
      activeUrl: "http://localhost:4000/",
    });
  });

  it("復元GETが失敗（non-ok）したセッションでは保存を走らせない（保存済み一覧の上書き消去を防ぐ）", async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: false });
    const { restoreBrowserTabs, startWatching } = useBrowserTabsPersist();
    await restoreBrowserTabs();
    expect(store.isRestored).toBe(false);

    cleanups.push(startWatching());
    store.openBrowserTab("http://localhost:3000/");
    await flushSave();

    expect(putCalls().length).toBe(0);
  });

  it("復元GETが例外を投げた場合も isRestored は立たず保存しない", async () => {
    apiFetchMock.mockRejectedValueOnce(new Error("network"));
    const { restoreBrowserTabs, startWatching } = useBrowserTabsPersist();
    await restoreBrowserTabs();
    expect(store.isRestored).toBe(false);

    cleanups.push(startWatching());
    store.openBrowserTab("http://localhost:3000/");
    await flushSave();

    expect(putCalls().length).toBe(0);
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

  it("復元時に旧形式のURL（https:example.com 等）を正規化して保持する — 生のまま残すと次の保存PUTが422で全滅する", async () => {
    apiFetchMock.mockResolvedValueOnce(
      okResponse({
        tabs: [{ url: "https:example.com" }, { url: "http://localhost:3000/" }],
        activeUrl: "https:example.com",
      }),
    );
    const { restoreBrowserTabs } = useBrowserTabsPersist();
    await restoreBrowserTabs();

    expect(store.tabs.map((t) => t.url)).toEqual(["https://example.com/", "http://localhost:3000/"]);
    // activeUrl も正規化してから突き合わせるため、正規化後のタブと一致する
    expect(store.activeBrowserTabId).toBe(store.tabs[0].id);
  });

  it("復元失敗後にローカルで開いたタブは、リトライ成功時にサーバー分とマージされて残り、サーバーへも反映される", async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: false });
    const { restoreBrowserTabs } = useBrowserTabsPersist();
    await restoreBrowserTabs();
    expect(store.isRestored).toBe(false);

    const localId = store.openBrowserTab("http://localhost:5000/");
    expect(store.activeBrowserTabId).toBe(localId);

    apiFetchMock.mockResolvedValue(
      okResponse({ tabs: [{ url: "http://localhost:3000/" }], activeUrl: "http://localhost:3000/" }),
    );
    await restoreBrowserTabs();

    expect(store.isRestored).toBe(true);
    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:3000/", "http://localhost:5000/"]);
    // アクティブタブはローカル優先
    expect(store.tabs.find((t) => t.id === store.activeBrowserTabId)?.url).toBe("http://localhost:5000/");

    // マージ結果（サーバーがまだ知らないローカル分）が保存される
    await vi.advanceTimersByTimeAsync(LAYOUT_SAVE_DEBOUNCE_MS + 10);
    expect(putCalls().length).toBe(1);
    expect(putCalls()[0][1].body).toEqual({
      tabs: [{ url: "http://localhost:3000/" }, { url: "http://localhost:5000/" }],
      activeUrl: "http://localhost:5000/",
    });
  });

  it("復元済みストアでの再復元（再マウント等）はマージせずサーバー状態で置き換える — 他クライアントが閉じたタブを復活させない", async () => {
    apiFetchMock.mockResolvedValueOnce(
      okResponse({
        tabs: [{ url: "http://localhost:3000/" }, { url: "http://localhost:4000/" }],
        activeUrl: "http://localhost:4000/",
      }),
    );
    const { restoreBrowserTabs } = useBrowserTabsPersist();
    await restoreBrowserTabs();
    expect(store.tabs.length).toBe(2);

    // 他クライアントが4000を閉じた後の再マウント相当: ストアには前回の残骸が残っている
    apiFetchMock.mockResolvedValue(
      okResponse({ tabs: [{ url: "http://localhost:3000/" }], activeUrl: "http://localhost:3000/" }),
    );
    await restoreBrowserTabs();

    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:3000/"]);
    // マージしていないので保存も走らない
    await vi.advanceTimersByTimeAsync(LAYOUT_SAVE_DEBOUNCE_MS + 10);
    expect(putCalls().length).toBe(0);
  });

  it("再マウント相当の再復元が失敗したら、成功するまで保存を止める（残骸一覧のPUTによる上書き防止）", async () => {
    apiFetchMock.mockResolvedValueOnce(
      okResponse({ tabs: [{ url: "http://localhost:3000/" }], activeUrl: null }),
    );
    const { restoreBrowserTabs, startWatching } = useBrowserTabsPersist();
    await restoreBrowserTabs();
    expect(store.isRestored).toBe(true);
    cleanups.push(startWatching());

    // 再マウント相当: 復元済みストアのまま再復元が失敗（429/500等）
    apiFetchMock.mockResolvedValueOnce({ ok: false });
    await restoreBrowserTabs();
    expect(store.isRestored).toBe(false);

    // 復元が成功するまで、タブ操作しても前回マウントの残骸一覧をPUTしない
    store.openBrowserTab("http://localhost:5000/");
    await flushSave();
    expect(putCalls().length).toBe(0);
  });

  it("connectivity:backが来ない失敗（429等）でも一定間隔で復元をリトライし、再マウントの残骸はマージしない", async () => {
    // 復元済みストア（3000/4000が残骸として残る）で再復元が失敗
    apiFetchMock.mockResolvedValueOnce(
      okResponse({
        tabs: [{ url: "http://localhost:3000/" }, { url: "http://localhost:4000/" }],
        activeUrl: null,
      }),
    );
    const { restoreBrowserTabs, startWatching } = useBrowserTabsPersist();
    // 本番と同じく watcher を先に登録する（リトライ予約は購読者がいる間だけ行われる）
    cleanups.push(startWatching());
    await restoreBrowserTabs();

    apiFetchMock.mockResolvedValueOnce({ ok: false });
    await restoreBrowserTabs();
    expect(store.isRestored).toBe(false);

    // 失敗中にローカルで開いた新規タブ（残骸ではない）
    store.openBrowserTab("http://localhost:5000/");

    // 他クライアントが4000を閉じた状態で、タイマーによる自動リトライが成功する
    apiFetchMock.mockResolvedValue(
      okResponse({ tabs: [{ url: "http://localhost:3000/" }], activeUrl: "http://localhost:3000/" }),
    );
    await vi.advanceTimersByTimeAsync(BROWSER_TABS_RESTORE_RETRY_MS + 10);

    expect(store.isRestored).toBe(true);
    // 4000（残骸）は復活せず、5000（失敗中のローカル操作）はマージされて残る
    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:3000/", "http://localhost:5000/"]);
    expect(store.tabs.find((t) => t.id === store.activeBrowserTabId)?.url).toBe("http://localhost:5000/");
  });

  it("復元の適用自体では保存しない（watcherを先に登録していても、無変更のGETスナップショットをPUTし返さない）", async () => {
    apiFetchMock.mockResolvedValueOnce(
      okResponse({ tabs: [{ url: "http://localhost:3000/" }], activeUrl: "http://localhost:3000/" }),
    );
    const { restoreBrowserTabs, startWatching } = useBrowserTabsPersist();
    // 本番と同じく watcher を復元より先に登録する
    cleanups.push(startWatching());
    await restoreBrowserTabs();

    await flushSave();
    expect(putCalls().length).toBe(0);
  });

  it("クリーンアップ後に復元GETの失敗が解決しても、リトライは予約されない（ログイン画面での永久ポーリング防止）", async () => {
    let rejectFetch;
    apiFetchMock.mockReturnValueOnce(new Promise((_, rej) => { rejectFetch = rej; }));
    const { restoreBrowserTabs, startWatching } = useBrowserTabsPersist();
    const cleanup = startWatching();
    const pending = restoreBrowserTabs();
    // 復元GETが未解決のままアンマウント（ログアウト）相当
    cleanup();
    rejectFetch(new Error("network"));
    await pending;

    const callsAfter = apiFetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(BROWSER_TABS_RESTORE_RETRY_MS * 2 + 10);
    expect(apiFetchMock.mock.calls.length).toBe(callsAfter);
  });

  it("debounce待ちの保存は再復元の開始時に破棄され、古い一覧でサーバーを上書きしない", async () => {
    apiFetchMock.mockResolvedValueOnce(
      okResponse({ tabs: [{ url: "http://localhost:3000/" }], activeUrl: null }),
    );
    const { restoreBrowserTabs, startWatching } = useBrowserTabsPersist();
    await restoreBrowserTabs();
    cleanups.push(startWatching());

    // 変更（保存はdebounce待ちのままキューに残る）→ 窓が閉じる前に再復元が始まる
    store.openBrowserTab("http://localhost:4000/");
    await nextTick();
    apiFetchMock.mockResolvedValue(
      okResponse({ tabs: [{ url: "http://localhost:3000/" }], activeUrl: null }),
    );
    const p = restoreBrowserTabs();
    await vi.advanceTimersByTimeAsync(LAYOUT_SAVE_DEBOUNCE_MS + 10);
    await p;
    await flushSave();

    // 破棄されなかった場合に飛ぶはずの「4000を含む古い一覧」のPUTが無いこと
    // （synced後のwatcher再発火によるサーバー状態と同一内容のPUTは許容する）
    const stale = putCalls().filter(([, opts]) => JSON.stringify(opts.body).includes("4000"));
    expect(stale.length).toBe(0);
    // 未保存だった変更はサーバー状態が正となる
    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:3000/"]);
  });

  it("復元GETの並行実行はin-flightのPromiseを共有して1本にまとめる", async () => {
    let resolveFetch;
    apiFetchMock.mockReturnValue(new Promise((r) => { resolveFetch = r; }));
    const { restoreBrowserTabs } = useBrowserTabsPersist();

    const p1 = restoreBrowserTabs();
    const p2 = restoreBrowserTabs();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(okResponse({ tabs: [{ url: "http://localhost:3000/" }], activeUrl: null }));
    await p1;
    await p2;
    expect(store.isRestored).toBe(true);
    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:3000/"]);

    // 完了後は解放され、次の呼び出しは新しくGETする
    apiFetchMock.mockResolvedValue(okResponse({ tabs: [], activeUrl: null }));
    await restoreBrowserTabs();
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it("復元失敗のまま接続が復帰（connectivity:back）したら復元をリトライして永続化を復活させる", async () => {
    apiFetchMock.mockRejectedValueOnce(new Error("network"));
    const { restoreBrowserTabs, startWatching } = useBrowserTabsPersist();
    await restoreBrowserTabs();
    expect(store.isRestored).toBe(false);

    cleanups.push(startWatching());
    apiFetchMock.mockResolvedValue(
      okResponse({ tabs: [{ url: "http://localhost:3000/" }], activeUrl: null }),
    );
    emit("connectivity:back");
    await flushMicrotasks();

    expect(store.isRestored).toBe(true);
    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:3000/"]);
  });

  it("復元済みなら connectivity:back で復元をやり直さない", async () => {
    apiFetchMock.mockResolvedValueOnce(okResponse({ tabs: [], activeUrl: null }));
    const { restoreBrowserTabs, startWatching } = useBrowserTabsPersist();
    await restoreBrowserTabs();
    expect(store.isRestored).toBe(true);

    cleanups.push(startWatching());
    const callsBefore = apiFetchMock.mock.calls.length;
    emit("connectivity:back");
    await flushMicrotasks();
    expect(apiFetchMock.mock.calls.length).toBe(callsBefore);
  });
});
