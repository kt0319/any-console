// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { usePwaInstall } from "../../ui/composables/usePwaInstall.js";

function firePrompt() {
  const event = new Event("beforeinstallprompt");
  /** @type {any} */ (event).prompt = vi.fn();
  /** @type {any} */ (event).userChoice = Promise.resolve({ outcome: "accepted" });
  window.dispatchEvent(event);
  return event;
}

describe("usePwaInstall", () => {
  it("イベント未発火の間はfalse（呼び出し側が手動手順へフォールバック）", async () => {
    const { promptInstall } = usePwaInstall();
    expect(await promptInstall()).toBe(false);
  });

  it("キャプチャ済みプロンプトを表示してtrueを返し、消費後はfalseに戻る", async () => {
    const { promptInstall } = usePwaInstall();
    const event = firePrompt();
    expect(await promptInstall()).toBe(true);
    expect(event.prompt).toHaveBeenCalledTimes(1);
    // 消費済み（同じプロンプトは再利用できない）
    expect(await promptInstall()).toBe(false);
  });

  it("複数回use（再マウント相当）してもリスナは1つで、後のインスタンスもイベントを受け取れる", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    usePwaInstall();
    const second = usePwaInstall();
    expect(addSpy.mock.calls.filter(([type]) => type === "beforeinstallprompt")).toHaveLength(0);
    addSpy.mockRestore();

    const event = firePrompt();
    expect(await second.promptInstall()).toBe(true);
    expect(event.prompt).toHaveBeenCalled();
  });
});
