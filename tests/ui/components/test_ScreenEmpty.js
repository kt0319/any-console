// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ScreenEmpty from "../../../ui/components/ScreenEmpty.vue";
import { useLayoutStore } from "../../../ui/stores/layout.js";
import { expectNoA11yViolations } from "./axe-helper.js";

const apiGetMock = vi.fn();

vi.mock("../../../ui/composables/useApi.js", () => ({
  useApi: () => ({ apiGet: (...args) => apiGetMock(...args) }),
}));

// マイクロタスクの深さ(getWithRetry→apiGet→auth_requiredチェック→devices取得、と
// 直列awaitが連鎖する)を数えず確実に流すため、マクロタスク境界(setTimeout)まで待つ。
async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function mockApi({ authRequired, devices }) {
  apiGetMock.mockImplementation(async (url) => {
    if (url === "/settings/auth") return { ok: true, data: { auth_required: authRequired } };
    if (url === "/devices") return { ok: true, data: devices };
    if (url === "/system/info") return { ok: true, data: null };
    return { ok: false, data: null };
  });
}

describe("ScreenEmpty: phone pairing shortcut", () => {
  let wrapper;

  beforeEach(() => {
    setActivePinia(createPinia());
    apiGetMock.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = "";
  });

  it("shows the shortcut on a PC-sized viewport with auth on and no mobile device yet", async () => {
    const layoutStore = useLayoutStore();
    layoutStore.isPanelBottom = false;
    mockApi({ authRequired: true, devices: [] });

    wrapper = mount(ScreenEmpty, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.text()).toContain("Open on your phone");
  });

  it("shows the shortcut on a mobile-sized viewport too", async () => {
    const layoutStore = useLayoutStore();
    layoutStore.isPanelBottom = true;
    mockApi({ authRequired: true, devices: [] });

    wrapper = mount(ScreenEmpty, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.text()).toContain("Open on your phone");
  });

  it("collapses the Setup section once all eligible items are done, and keeps the checkmark once expanded", async () => {
    const layoutStore = useLayoutStore();
    layoutStore.isPanelBottom = false;
    mockApi({
      authRequired: true,
      devices: [{ id: "dev_1", name: "Safari on iOS", user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1" }],
    });

    wrapper = mount(ScreenEmpty, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.text()).not.toContain("Open on your phone");
    await wrapper.find(".screen-empty-section-toggle").trigger("click");

    expect(wrapper.text()).toContain("Open on your phone");
    expect(wrapper.find(".screen-empty-menu-item-done").exists()).toBe(true);
  });

  it("hides the shortcut when authentication is disabled", async () => {
    const layoutStore = useLayoutStore();
    layoutStore.isPanelBottom = false;
    mockApi({ authRequired: false, devices: [] });

    wrapper = mount(ScreenEmpty, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.text()).not.toContain("Open on your phone");
  });

  it("emits settings:open for PairDeviceConfig when clicked", async () => {
    const layoutStore = useLayoutStore();
    layoutStore.isPanelBottom = false;
    mockApi({ authRequired: true, devices: [] });

    wrapper = mount(ScreenEmpty, { attachTo: document.body });
    await flushPromises();

    const { on } = await import("../../../ui/app-bridge.js");
    const handler = vi.fn();
    const off = on("settings:open", handler);
    await wrapper.findAll("button").find((b) => b.text().includes("Open on your phone"))?.trigger("click");

    expect(handler).toHaveBeenCalledWith({ view: "PairDeviceConfig" });
    off();
  });

  it("has no a11y violations with the phone pairing shortcut visible", async () => {
    const layoutStore = useLayoutStore();
    layoutStore.isPanelBottom = false;
    mockApi({ authRequired: true, devices: [] });

    wrapper = mount(ScreenEmpty, { attachTo: document.body });
    await flushPromises();

    await expectNoA11yViolations(wrapper.element);
  });
});
