// @vitest-environment happy-dom
// @ts-check
/**
 * 統合テスト:
 * - Terminal resize fit 抑制
 * - layout:fitAll がフォーム送信で発火しないこと
 * - WorkspaceStatusBar ヒントボタン
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { fitTerminal } from "../../ui/composables/useTerminalResize.js";
import { useTerminal } from "../../ui/composables/useTerminal.js";
import { useConfirm } from "../../ui/composables/useConfirm.js";
import { usePrompt } from "../../ui/composables/usePrompt.js";
import { emit, on } from "../../ui/app-bridge.js";
import ConfirmDialog from "../../ui/components/ConfirmDialog.vue";
import PromptDialog from "../../ui/components/PromptDialog.vue";
import WorkspaceStatusBar from "../../ui/components/WorkspaceStatusBar.vue";
import { useTerminalStore } from "../../ui/stores/terminal.js";

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
  it("terminal:send を emit しても layout:fitAll は発火しない", () => {
    const handler = vi.fn();
    const off = on("layout:fitAll", handler);
    emit("terminal:send", { data: "ls -la\n" });
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it("input:submit を emit しても layout:fitAll は発火しない", () => {
    const handler = vi.fn();
    const off = on("layout:fitAll", handler);
    emit("input:submit", { text: "echo hello" });
    expect(handler).not.toHaveBeenCalled();
    off();
  });
});

// ── Test 4: WorkspaceStatusBar ヒントボタン ──────────────────────────────────

describe("WorkspaceStatusBar: ワークスペース未選択時のヒントボタン", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Open ボタンをクリックすると workspace:openModal が emit される", async () => {
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
