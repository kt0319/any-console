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
import { emit, on } from "../../ui/app-bridge.js";
import WorkspaceStatusBar from "../../ui/components/WorkspaceStatusBar.vue";

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

  it("ヒントボタンをクリックすると workspace:openModal が emit される", async () => {
    const handler = vi.fn();
    const off = on("workspace:openModal", handler);

    const wrapper = mount(WorkspaceStatusBar);
    const hint = wrapper.find(".status-empty-hint");
    expect(hint.exists()).toBe(true);

    await hint.trigger("click");
    expect(handler).toHaveBeenCalledOnce();

    wrapper.unmount();
    off();
  });
});
