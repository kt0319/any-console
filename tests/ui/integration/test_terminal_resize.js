// @vitest-environment happy-dom
// @ts-check
/** 統合テスト: Terminal の resize・WebSocket 接続・layout:fitAll */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { fitTerminal, sendResize } from "../../../ui/composables/useTerminalResize.ts";
import { useTerminal } from "../../../ui/composables/useTerminal.ts";
import { emit, on } from "../../../ui/app-bridge.ts";

// ── Test 1: fit 抑制 ──────────────────────────────────────────────────────────

describe("fitTerminal: DOM サイズ変化なしの fit 抑制", () => {
  const visibleFrameIds = [];

  afterEach(() => {
    for (const id of visibleFrameIds) document.getElementById(id)?.remove();
    visibleFrameIds.length = 0;
  });

  function makeVisibleFrame(tabId) {
    const id = `frame-${tabId}`;
    const frame = document.createElement("div");
    frame.id = id;
    frame.getBoundingClientRect = () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400 });
    document.body.appendChild(frame);
    visibleFrameIds.push(id);
  }

  it("cols/rows が前回と同一の場合は fit() を呼ばない", () => {
    makeVisibleFrame("t1");
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
    makeVisibleFrame("t2");
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
    makeVisibleFrame("t3");
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

// ── Test: 非表示タブは fit/resize を送らない（バックグラウンド復帰時の巻き込み防止） ──

describe("fitTerminal / sendResize: 非表示フレームのガード", () => {
  afterEach(() => {
    document.getElementById("frame-hidden")?.remove();
  });

  function makeHiddenFrame() {
    const frame = document.createElement("div");
    frame.id = "frame-hidden";
    frame.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
    document.body.appendChild(frame);
    return frame;
  }

  it("frame が幅0(非表示)なら fit() を呼ばない", () => {
    makeHiddenFrame();
    const fit = vi.fn();
    const tab = {
      id: "hidden",
      term: {},
      fitAddon: { proposeDimensions: () => ({ cols: 40, rows: 10 }), fit },
    };
    fitTerminal(tab, { force: true });
    expect(fit).not.toHaveBeenCalled();
  });

  it("frame が幅0(非表示)なら resize メッセージを送らない", () => {
    makeHiddenFrame();
    const send = vi.fn();
    const tab = {
      id: "hidden",
      term: { cols: 40, rows: 10 },
      ws: { readyState: 1 /* WebSocket.OPEN */, send },
    };
    sendResize(tab);
    expect(send).not.toHaveBeenCalled();
  });

  it("frame 要素が DOM に無い（スプリット枠外で未マウント）場合も fit()/resize を送らない", () => {
    // 対応する frame-<id> を一切作らない = TerminalPane 自体が未マウントなタブを模す
    const fit = vi.fn();
    const send = vi.fn();
    const tab = {
      id: "not-mounted",
      term: { cols: 40, rows: 10 },
      fitAddon: { proposeDimensions: () => ({ cols: 80, rows: 24 }), fit },
      ws: { readyState: 1 /* WebSocket.OPEN */, send },
    };
    fitTerminal(tab, { force: true });
    sendResize(tab);
    expect(fit).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
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
