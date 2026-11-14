// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vibrateForTapTarget } from "../../ui/utils/tap-haptics.ts";
import { TAP_VIBRATE_MS } from "../../ui/utils/constants.ts";

describe("vibrateForTapTarget", () => {
  let vibrate;

  beforeEach(() => {
    vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    document.body.innerHTML = `
      <button id="btn"><span id="inner">OK</span></button>
      <button id="off" disabled>NG</button>
      <div id="key" class="quick-key">k</div>
      <div id="plain">text</div>`;
  });

  afterEach(() => {
    delete navigator.vibrate;
  });

  it("ボタン内の要素でも振動する", () => {
    vibrateForTapTarget(document.getElementById("inner"));
    expect(vibrate).toHaveBeenCalledWith(TAP_VIBRATE_MS);
  });

  it("quick-key（touchstart.prevent 系のキー）で振動する", () => {
    vibrateForTapTarget(document.getElementById("key"));
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("disabled ボタンと非ボタン要素では振動しない", () => {
    vibrateForTapTarget(document.getElementById("off"));
    vibrateForTapTarget(document.getElementById("plain"));
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("navigator.vibrate が無い環境でも例外にならない", () => {
    delete navigator.vibrate;
    expect(() => vibrateForTapTarget(document.getElementById("btn"))).not.toThrow();
  });
});
