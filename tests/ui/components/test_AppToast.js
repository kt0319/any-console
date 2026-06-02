// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

vi.mock("../../../ui/app-bridge.js", () => ({ emit: vi.fn(), on: vi.fn(() => () => {}) }));
vi.mock("../../../ui/utils/constants.js", () => ({ TOAST_DEFAULT_DURATION_MS: 5000 }));

// Teleport to="body" のため wrapper.find() ではなく document.body から検索する
const bodyFind = (sel) => document.body.querySelector(sel);
const bodyFindAll = (sel) => [...document.body.querySelectorAll(sel)];

let wrapper;

beforeEach(async () => {
  vi.resetModules();
  const { default: AppToast } = await import("../../../ui/components/AppToast.vue");
  wrapper = mount(AppToast, { attachTo: document.body });
});

afterEach(() => {
  wrapper.unmount();
  // Teleport の残留 DOM を除去
  document.body.querySelectorAll(".toast").forEach((el) => el.remove());
});

describe("AppToast", () => {
  it("show() でトーストを表示する", async () => {
    wrapper.vm.show("テストメッセージ", "error");
    await nextTick();
    expect(bodyFind(".toast")?.textContent).toContain("テストメッセージ");
  });

  it("error タイプに toast-error クラスが付く", async () => {
    wrapper.vm.show("エラー", "error");
    await nextTick();
    expect(bodyFind(".toast-error")).not.toBeNull();
  });

  it("success タイプに toast-success クラスが付く", async () => {
    wrapper.vm.show("成功", "success");
    await nextTick();
    expect(bodyFind(".toast-success")).not.toBeNull();
  });

  it("info タイプに toast-info クラスが付く", async () => {
    wrapper.vm.show("情報", "info");
    await nextTick();
    expect(bodyFind(".toast-info")).not.toBeNull();
  });

  it("複数行メッセージを改行で分割して描画する", async () => {
    wrapper.vm.show("1行目\n2行目", "info");
    await nextTick();
    const lines = bodyFindAll(".toast-line");
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toBe("1行目");
    expect(lines[1].textContent).toBe("2行目");
  });

  it("クリックでトーストが消える", async () => {
    wrapper.vm.show("消えるか", "info");
    await nextTick();
    expect(bodyFind(".toast")).not.toBeNull();
    bodyFind(".toast")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(bodyFind(".toast")).toBeNull();
  });

  it("複数のトーストを同時に表示できる", async () => {
    wrapper.vm.show("A", "error");
    wrapper.vm.show("B", "success");
    await nextTick();
    expect(bodyFindAll(".toast")).toHaveLength(2);
  });

  it("error タイプの role は alert", async () => {
    wrapper.vm.show("アラート", "error");
    await nextTick();
    expect(bodyFind(".toast")?.getAttribute("role")).toBe("alert");
  });

  it("success タイプの role は status", async () => {
    wrapper.vm.show("ステータス", "success");
    await nextTick();
    expect(bodyFind(".toast")?.getAttribute("role")).toBe("status");
  });
});
