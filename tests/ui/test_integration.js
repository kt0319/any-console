// @vitest-environment happy-dom
// @ts-check
/**
 * 統合テスト:
 * - Terminal resize fit 抑制
 * - layout:fitAll がフォーム送信で発火しないこと
 * - WorkspaceStatusBar ヒントボタン
 */
import { defineComponent, ref } from "vue";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { fitTerminal } from "../../ui/composables/useTerminalResize.js";
import { useTerminal } from "../../ui/composables/useTerminal.js";
import { useConfirm } from "../../ui/composables/useConfirm.js";
import { usePrompt } from "../../ui/composables/usePrompt.js";
import { emit, on } from "../../ui/app-bridge.js";
import ConfirmDialog from "../../ui/components/ConfirmDialog.vue";
import PromptDialog from "../../ui/components/PromptDialog.vue";
import WorkspaceStatusBar from "../../ui/components/WorkspaceStatusBar.vue";
import WorkspaceDetail from "../../ui/components/WorkspaceDetail.vue";
import DispatchRunView from "../../ui/components/DispatchRunView.vue";
import AuthConfig from "../../ui/components/AuthConfig.vue";
import SendSnippet from "../../ui/components/SendSnippet.vue";
import SendHistory from "../../ui/components/SendHistory.vue";
import { useTerminalStore } from "../../ui/stores/terminal.js";
import { useAuthStore } from "../../ui/stores/auth.js";
import { useWorkspaceStore } from "../../ui/stores/workspace.js";
import { useInputStore } from "../../ui/stores/input.js";
import { applyDispatchQueue } from "../../ui/composables/useDispatchConfirm.js";
import { useKeyboardBarState } from "../../ui/composables/useKeyboardBarState.js";
import { EP_API_TOKENS, EP_SETTINGS_AUTH } from "../../ui/utils/endpoints.js";

// ── Test 1: fit 抑制 ──────────────────────────────────────────────────────────

describe("fitTerminal: DOM サイズ変化なしの fit 抑制", () => {
  it("cols/rows が前回と同一の場合は fit() を呼ばない", () => {
    const fit = vi.fn();
    const tab = {
      id: "t1",
      term: {},
      fitAddon: { proposeDimensions: () => ({ cols: 80, rows: 24 }), fit },
      _lastFitCols: 80,
      _lastFitRows: 24,
    };
    fitTerminal(tab);
    expect(fit).not.toHaveBeenCalled();
  });

  it("cols/rows が変化した場合は fit() を呼ぶ", () => {
    const fit = vi.fn();
    const tab = {
      id: "t2",
      term: {},
      fitAddon: { proposeDimensions: () => ({ cols: 100, rows: 30 }), fit },
      _lastFitCols: 80,
      _lastFitRows: 24,
    };
    fitTerminal(tab);
    expect(fit).toHaveBeenCalledOnce();
    expect(tab._lastFitCols).toBe(100);
    expect(tab._lastFitRows).toBe(30);
  });

  it("force=true の場合はサイズ同一でも fit() を呼ぶ", () => {
    const fit = vi.fn();
    const tab = {
      id: "t3",
      term: {},
      fitAddon: { proposeDimensions: () => ({ cols: 80, rows: 24 }), fit },
      _lastFitCols: 80,
      _lastFitRows: 24,
    };
    fitTerminal(tab, { force: true });
    expect(fit).toHaveBeenCalledOnce();
  });
});

// ── Test: connectTerminalWs の二重接続ガード ─────────────────────────────────

describe("connectTerminalWs: 二重接続ガード", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeTab() {
    return {
      id: 1,
      sessionId: "sess-guard",
      term: { cols: 45, rows: 30 },
      fitAddon: { proposeDimensions: () => ({ cols: 45, rows: 30 }), fit: vi.fn() },
      ws: null,
      _needsHistoryRestore: false,
      _inputBound: true,
    };
  }

  it("接続処理の並走呼び出しでは WS を 1 本しか張らない", async () => {
    const sockets = [];
    vi.stubGlobal("WebSocket", class {
      constructor(url) {
        this.url = url;
        sockets.push(this);
      }
      close() {}
      send() {}
    });
    const { connectTerminalWs } = useTerminal();
    const tab = makeTab();

    // 再接続タイマー・セッション復帰・タブ切替の並走を模擬する。
    // 2 本の WS が同じ xterm に書き込むと再描画が交錯して表示が崩れる。
    await Promise.all([connectTerminalWs(tab), connectTerminalWs(tab)]);
    expect(sockets.length).toBe(1);
    expect(tab.ws).toBe(sockets[0]);

    // 接続済みタブへの再呼び出しも新しい WS を張らない
    await connectTerminalWs(tab);
    expect(sockets.length).toBe(1);
  });

  it("非表示フレームでは xterm の現在サイズで接続する", async () => {
    const sockets = [];
    vi.stubGlobal("WebSocket", class {
      constructor(url) {
        this.url = url;
        sockets.push(this);
      }
      close() {}
      send() {}
    });
    const { connectTerminalWs } = useTerminal();
    // frame 要素が DOM に無い（非表示）タブ。サイズ未指定で接続すると
    // サーバがデフォルト 80x24 でアタッチし xterm のバッファ幅と食い違う。
    const tab = makeTab();
    tab.fitAddon = { proposeDimensions: () => undefined, fit: vi.fn() };

    await connectTerminalWs(tab);
    expect(sockets.length).toBe(1);
    expect(sockets[0].url).toContain("cols=45");
    expect(sockets[0].url).toContain("rows=30");
  });
});

// ── Test 2: layout:fitAll はフォーム送信で発火しない ─────────────────────────

describe("layout:fitAll のイベント分離", () => {
  it("terminal:url を emit しても layout:fitAll は発火しない", () => {
    const handler = vi.fn();
    const off = on("layout:fitAll", handler);
    emit("terminal:url", { uri: "https://example.com" });
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it("jobs:refresh を emit しても layout:fitAll は発火しない", () => {
    const handler = vi.fn();
    const off = on("layout:fitAll", handler);
    emit("jobs:refresh", {});
    expect(handler).not.toHaveBeenCalled();
    off();
  });
});

// ── Test 4: WorkspaceStatusBar 追加ワークスペースボタン ──────────────────────

describe("WorkspaceStatusBar: 素のターミナルの追加ワークスペースボタン", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cwd 不明時の Open ボタンをクリックすると workspace:openModal が emit される", async () => {
    const handler = vi.fn();
    const off = on("workspace:openModal", handler);

    // git でないタブを1つ用意（統合ステータスバーが出る状態）
    const terminalStore = useTerminalStore();
    terminalStore.openTabs.push({ id: 1, workspace: null, sessionId: "s1" });
    terminalStore.activeTabId = 1;

    const wrapper = mount(WorkspaceStatusBar);
    const openBtn = wrapper.find('[aria-label="Open a workspace"]');
    expect(openBtn.exists()).toBe(true);

    await openBtn.trigger("click");
    expect(handler).toHaveBeenCalledOnce();

    wrapper.unmount();
    off();
  });

  it("cwd が取れたら通常バーの先頭ボタンに Add ディレクトリ名 workspace を表示する", async () => {
    const authStore = useAuthStore();
    authStore.apiFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ cwd: "/Users/k-takasaki/work/any-console" }),
    });

    const terminalStore = useTerminalStore();
    terminalStore.openTabs.push({ id: 1, workspace: null, sessionId: "s1" });
    terminalStore.activeTabId = 1;

    const wrapper = mount(WorkspaceStatusBar);
    await flushPromises();

    const addBtn = wrapper.findAll("button").find((btn) =>
      btn.attributes("aria-label") === 'Add "any-console" workspace'
    );
    expect(addBtn).toBeTruthy();
    expect(addBtn.classes()).toContain("status-add-workspace-btn");
    expect(wrapper.find('[aria-label="Jobs"]').exists()).toBe(false);
    expect(wrapper.findAll("button").map((btn) => btn.attributes("aria-label"))).toEqual([
      'Add "any-console" workspace',
      "Files",
      "History",
      "Changes",
      "Branches",
    ]);
    expect(wrapper.find('[aria-label="Files"]').attributes("disabled")).toBeUndefined();
    for (const label of ["History", "Changes", "Branches"]) {
      expect(wrapper.find(`[aria-label="${label}"]`).attributes("disabled")).toBeDefined();
    }

    wrapper.unmount();
  });

  it("素のターミナルの Files は session cwd のブラウズとして開く", async () => {
    const handler = vi.fn();
    const off = on("git:openFileModal", handler);
    const authStore = useAuthStore();
    authStore.apiFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cwd: "/Users/k-takasaki/work/any-console" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cwd: "/Users/k-takasaki/work/current-dir" }),
      });

    const terminalStore = useTerminalStore();
    terminalStore.openTabs.push({ id: 1, workspace: null, sessionId: "s1" });
    terminalStore.activeTabId = 1;

    const wrapper = mount(WorkspaceStatusBar);
    await flushPromises();

    await wrapper.find('[aria-label="Files"]').trigger("click");
    await flushPromises();
    expect(handler).toHaveBeenCalledWith({
      pane: "files",
      terminalSessionId: "s1",
      rootLabel: "current-dir",
    });

    wrapper.unmount();
    off();
  });
});

describe("WorkspaceDetail: terminal cwd files", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("pane 更新時に terminalSessionId を保持する", async () => {
    const modalTitle = ref("");
    const modalBranch = ref("");
    const viewState = ref({
      detail: {
        pane: "files",
        terminalSessionId: "s1",
        rootLabel: "current-dir",
      },
    });
    const updateViewState = vi.fn((state) => {
      viewState.value = state;
    });

    const FileBrowserStub = defineComponent({
      template: "<div />",
      setup(_, { expose }) {
        expose({ load: vi.fn(), navigateToPath: vi.fn() });
      },
    });

    mount(WorkspaceDetail, {
      global: {
        provide: {
          modalTitle,
          modalBranch,
          viewState,
          updateViewState,
        },
        stubs: {
          FileBrowser: FileBrowserStub,
          GitHistory: true,
          GitChanges: true,
          GitChangeBranch: true,
          GitStash: true,
          WorkspaceJobsPane: true,
          GitHubIssuesPane: true,
          GitHubActionsPane: true,
          GitHubPRsPane: true,
          TerminalSelectPane: true,
        },
      },
    });
    await flushPromises();

    expect(updateViewState).toHaveBeenCalledWith({
      detail: {
        pane: "files",
        terminalSessionId: "s1",
        rootLabel: "current-dir",
      },
    });
    expect(viewState.value.detail.terminalSessionId).toBe("s1");
  });
});

describe("Dialog accessibility behavior", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("ConfirmDialog traps Tab focus inside the dialog", async () => {
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);

    const wrapper = mount(ConfirmDialog, { attachTo: document.body });
    const { confirm, onCancel } = useConfirm();
    const pending = confirm("Delete file?");
    await Promise.resolve();

    const buttons = wrapper.findAll("button");
    const first = buttons[0].element;
    const last = buttons[buttons.length - 1].element;
    const dialog = wrapper.find(".confirm-dialog");

    last.focus();
    await dialog.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    await dialog.trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    onCancel();
    await expect(pending).resolves.toBe(false);
    wrapper.unmount();
    document.body.innerHTML = "";
  });

  it("PromptDialog closes on Escape even when a button is focused", async () => {
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    outside.focus();

    const wrapper = mount(PromptDialog, { attachTo: document.body });
    const { prompt } = usePrompt();
    const pending = prompt({ title: "Rename", initialValue: "old.txt" });
    await Promise.resolve();

    const cancelButton = wrapper.find(".dialog-btn-cancel").element;
    cancelButton.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    await expect(pending).resolves.toBe(null);
    expect(document.activeElement).toBe(outside);

    wrapper.unmount();
    document.body.innerHTML = "";
  });
});

describe("DispatchRunView: dedup_key による置き換えの検知", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    applyDispatchQueue([]);
  });

  it("同じ id のまま payload が置き換わったら popView する（古い内容のまま実行されないように）", async () => {
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "first", branch: "main", retry_count: 1 } },
    ]);

    const popView = vi.fn();
    mount(DispatchRunView, {
      global: {
        provide: {
          modalTitle: ref(""),
          viewState: ref({ itemId: "d1" }),
          popView,
        },
      },
    });
    await flushPromises();
    expect(popView).not.toHaveBeenCalled();

    // dispatch_id は変えず内容だけ置き換わるケース（同一 dedup_key の連続失敗）。
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "second", branch: "feature/x", retry_count: 2 } },
    ]);
    await flushPromises();

    expect(popView).toHaveBeenCalled();
  });

  it("retry_count が変わらない再描画では popView しない", async () => {
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "first", branch: "main", retry_count: 1 } },
    ]);

    const popView = vi.fn();
    mount(DispatchRunView, {
      global: {
        provide: {
          modalTitle: ref(""),
          viewState: ref({ itemId: "d1" }),
          popView,
        },
      },
    });
    await flushPromises();

    // 同じスナップショットの再配信（内容変化なし）。
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "first", branch: "main", retry_count: 1 } },
    ]);
    await flushPromises();

    expect(popView).not.toHaveBeenCalled();
  });
});

// ── DispatchRunView: dirty workspace のブランチ切替ブロック ──────────────────

function mountDispatchRunView(itemId = "d1") {
  return mount(DispatchRunView, {
    global: {
      provide: {
        modalTitle: ref(""),
        viewState: ref({ itemId }),
        popView: vi.fn(),
      },
    },
  });
}

function findRunButton(wrapper) {
  return wrapper.findAll("button").find((b) => b.text().includes("Run"));
}

describe("DispatchRunView: dirty workspace でのブランチ切替ブロック", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    applyDispatchQueue([]);
  });

  it("ブランチを切り替える dispatch + dirty workspace は Run を disable し理由を表示する", async () => {
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "run", branch: "feature/x", create_branch: true, retry_count: 1 } },
    ]);
    useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 2 }];

    const wrapper = mountDispatchRunView();
    await flushPromises();

    const runBtn = findRunButton(wrapper);
    expect(runBtn.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("uncommitted changes (2 files)");
    wrapper.unmount();
  });

  it("ファイル数が1件なら単数形で表示する", async () => {
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "run", branch: "feature/x", create_branch: true, retry_count: 1 } },
    ]);
    useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 1 }];

    const wrapper = mountDispatchRunView();
    await flushPromises();

    expect(wrapper.text()).toContain("uncommitted changes (1 file)");
    wrapper.unmount();
  });

  it("ブランチが現在ブランチと同じならブロックしない", async () => {
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "run", branch: "main", create_branch: true, retry_count: 1 } },
    ]);
    useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 3 }];

    const wrapper = mountDispatchRunView();
    await flushPromises();

    const runBtn = findRunButton(wrapper);
    expect(runBtn.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("Create branch オフなら既存ブランチへの切替 + dirty でもブロックしない", async () => {
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "run", branch: "feature/existing", create_branch: false, retry_count: 1 } },
    ]);
    useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 4 }];

    const wrapper = mountDispatchRunView();
    await flushPromises();

    const runBtn = findRunButton(wrapper);
    expect(runBtn.attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).not.toContain("uncommitted changes");
    wrapper.unmount();
  });

  it("Change branch の初期値が実在しないブランチなら Run を disable してエラーを表示する", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/branches")) {
        return { ok: true, json: async () => [{ name: "main" }, { name: "feature/y" }] };
      }
      return { ok: true, json: async () => ({}) };
    });
    try {
      applyDispatchQueue([
        { id: "d1", request: { workspace: "ws1", text: "run", branch: "feature/deleted", create_branch: false, retry_count: 1 } },
      ]);
      useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 0 }];

      const wrapper = mountDispatchRunView();
      await flushPromises();

      const runBtn = findRunButton(wrapper);
      expect(runBtn.attributes("disabled")).toBeDefined();
      expect(wrapper.text()).toContain('Branch "feature/deleted" does not exist');
      wrapper.unmount();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Change branch の初期値が実在するブランチならブロックしない", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/branches")) {
        return { ok: true, json: async () => [{ name: "main" }, { name: "feature/existing" }] };
      }
      return { ok: true, json: async () => ({}) };
    });
    try {
      applyDispatchQueue([
        { id: "d1", request: { workspace: "ws1", text: "run", branch: "feature/existing", create_branch: false, retry_count: 1 } },
      ]);
      useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 0 }];

      const wrapper = mountDispatchRunView();
      await flushPromises();

      const runBtn = findRunButton(wrapper);
      expect(runBtn.attributes("disabled")).toBeUndefined();
      expect(wrapper.text()).not.toContain("does not exist");
      wrapper.unmount();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("ブランチ未指定（現在ブランチのまま）ならdirtyでもブロックしない", async () => {
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "run", retry_count: 1 } },
    ]);
    useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 5 }];

    const wrapper = mountDispatchRunView();
    await flushPromises();

    const runBtn = findRunButton(wrapper);
    expect(runBtn.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("workspace がクリーン（changed_files: 0）ならブロックしない", async () => {
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "run", branch: "feature/y", create_branch: true, retry_count: 1 } },
    ]);
    useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 0 }];

    const wrapper = mountDispatchRunView();
    await flushPromises();

    const runBtn = findRunButton(wrapper);
    expect(runBtn.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });
});

// ── AuthConfig: API Tokens ────────────────────────────────────────────────

describe("AuthConfig: API Tokens", () => {
  /** @type {import("vitest").Mock} */
  let fetchMock;

  function jsonResponse(data, status = 200) {
    return Promise.resolve({ ok: status < 400, status, json: async () => data });
  }

  function stubFetch(handlers) {
    fetchMock = vi.fn((url, opts = {}) => {
      const method = opts.method || "GET";
      for (const [matchUrl, matchMethod, respond] of handlers) {
        if (url === matchUrl && method === matchMethod) return respond();
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("既存トークンを一覧表示する（scope チップ・Last used 込み）", async () => {
    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => jsonResponse([
        { id: "tok_1", name: "github-actions", scope: "dispatch", last_used: null },
      ])],
    ]);

    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();

    expect(wrapper.text()).toContain("github-actions");
    expect(wrapper.text()).toContain("dispatch");
    expect(wrapper.text()).toContain("Never");
    wrapper.unmount();
  });

  it("作成すると raw トークンを一度だけ表示し、一覧を再読込する", async () => {
    let listCallCount = 0;
    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => {
        listCallCount += 1;
        const data = listCallCount === 1 ? [] : [{ id: "tok_2", name: "ci", scope: "dispatch", last_used: null }];
        return jsonResponse(data);
      }],
      [EP_API_TOKENS, "POST", () => jsonResponse({
        id: "tok_2", name: "ci", scope: "dispatch", last_used: null, token: "raw-secret-value",
      })],
    ]);

    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();

    await wrapper.find('input[placeholder^="Token name"]').setValue("ci");
    const createBtn = wrapper.findAll("button").find((b) => b.text() === "Create");
    await createBtn.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Copy this token now");
    expect(wrapper.find(".security-token-row input[readonly]").element.value).toBe("raw-secret-value");
    expect(wrapper.text()).toContain("ci");
    expect(listCallCount).toBe(2);
    wrapper.unmount();
  });

  it("Copy ボタンでクリップボードへコピーする", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const origClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "POST", () => jsonResponse({
        id: "tok_3", name: "ci", scope: "dispatch", last_used: null, token: "copy-me-token",
      })],
    ]);

    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();
    await wrapper.find('input[placeholder^="Token name"]').setValue("ci");
    await wrapper.findAll("button").find((b) => b.text() === "Create").trigger("click");
    await flushPromises();

    const copyBtn = wrapper.find('button[aria-label="Copy token"]');
    await copyBtn.trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith("copy-me-token");
    Object.defineProperty(navigator, "clipboard", { value: origClipboard, configurable: true });
    wrapper.unmount();
  });

  it("Revoke は useConfirm 経由で確認してから削除する", async () => {
    let deleteCalled = false;
    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => jsonResponse(
        deleteCalled ? [] : [{ id: "tok_4", name: "ci", scope: "dispatch", last_used: null }],
      )],
      ["/api-tokens/tok_4", "DELETE", () => {
        deleteCalled = true;
        return jsonResponse({ ok: true });
      }],
    ]);

    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();
    expect(wrapper.text()).toContain("ci");

    const confirmState = useConfirm();
    const revokeBtn = wrapper.find('button[aria-label="Revoke API token"]');
    const clickPromise = revokeBtn.trigger("click");
    await Promise.resolve();
    await flushPromises();
    confirmState.onOk();
    await clickPromise;
    await flushPromises();

    expect(deleteCalled).toBe(true);
    expect(wrapper.text()).not.toContain("ci");
    wrapper.unmount();
  });
});

// ── SendSnippet / SendHistory: 設定画面からの挿入 ──────────────────────────

describe("SendSnippet: 設定画面からのタップ挿入", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("スニペット行をタップすると keyboard:setDraft / snippet:use / modal:close が発火する", async () => {
    const inputStore = useInputStore();
    inputStore.snippetsCache = [{ label: "ls", command: "ls -la" }];

    const setDraftHandler = vi.fn();
    const useHandler = vi.fn();
    const closeHandler = vi.fn();
    const offs = [
      on("keyboard:setDraft", setDraftHandler),
      on("snippet:use", useHandler),
      on("modal:close", closeHandler),
    ];

    const wrapper = mount(SendSnippet, { global: { provide: { modalTitle: ref("") } } });
    await wrapper.find(".snippet-command").trigger("click");

    expect(setDraftHandler).toHaveBeenCalledWith({ command: "ls -la" });
    expect(useHandler).toHaveBeenCalledWith({ command: "ls -la" });
    expect(closeHandler).toHaveBeenCalledOnce();

    wrapper.unmount();
    offs.forEach((off) => off());
  });
});

describe("SendHistory: 設定画面からのタップ挿入・削除", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("履歴行をタップすると keyboard:setDraft / modal:close が発火する（snippet:use は発火しない）", async () => {
    const inputStore = useInputStore();
    inputStore.inputHistory = ["echo hi"];

    const setDraftHandler = vi.fn();
    const useHandler = vi.fn();
    const closeHandler = vi.fn();
    const offs = [
      on("keyboard:setDraft", setDraftHandler),
      on("snippet:use", useHandler),
      on("modal:close", closeHandler),
    ];

    const wrapper = mount(SendHistory, { global: { provide: { modalTitle: ref("") } } });
    await wrapper.find(".history-command").trigger("click");

    expect(setDraftHandler).toHaveBeenCalledWith({ command: "echo hi" });
    expect(useHandler).not.toHaveBeenCalled();
    expect(closeHandler).toHaveBeenCalledOnce();

    wrapper.unmount();
    offs.forEach((off) => off());
  });

  it("削除ボタンで inputStore.removeInputHistory が呼ばれる", async () => {
    const inputStore = useInputStore();
    inputStore.inputHistory = ["echo hi"];

    const wrapper = mount(SendHistory, { global: { provide: { modalTitle: ref("") } } });
    await wrapper.find(".history-delete").trigger("click");

    expect(inputStore.inputHistory).toEqual([]);
    wrapper.unmount();
  });
});

// ── useKeyboardBarState: スニペット/履歴パネルの巡回 ────────────────────────

describe("useKeyboardBarState: toggleSnippetView の巡回", () => {
  function mountState() {
    let state;
    const wrapper = mount(defineComponent({
      setup() {
        state = useKeyboardBarState({ keyboardInput: ref(null), clearModifiers: () => {} });
        return () => null;
      },
    }));
    return { wrapper, state: () => state };
  }

  it("none→snippets→history→none の巡回で settings:open / modal:close を発火する", async () => {
    const openHandler = vi.fn();
    const closeHandler = vi.fn();
    const offs = [
      on("settings:open", openHandler),
      on("modal:close", closeHandler),
    ];
    const { wrapper, state } = mountState();

    state().toggleSnippetView();
    expect(state().snippetPanelView.value).toBe("snippets");
    expect(openHandler).toHaveBeenLastCalledWith({ view: "SendSnippet" });

    state().toggleSnippetView();
    expect(state().snippetPanelView.value).toBe("history");
    expect(openHandler).toHaveBeenLastCalledWith({ view: "SendHistory" });

    state().toggleSnippetView();
    expect(state().snippetPanelView.value).toBe("none");
    expect(closeHandler).toHaveBeenCalledOnce();

    wrapper.unmount();
    offs.forEach((off) => off());
  });

  it("settings:closed を受けると巡回状態が none にリセットされる", () => {
    const { wrapper, state } = mountState();
    state().toggleSnippetView();
    expect(state().snippetPanelView.value).toBe("snippets");

    emit("settings:closed");
    expect(state().snippetPanelView.value).toBe("none");

    wrapper.unmount();
  });
});
