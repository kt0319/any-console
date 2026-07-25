// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import PairDeviceConfig from "../../../ui/components/PairDeviceConfig.vue";
import { PAIRING_STATUS_POLL_MS } from "../../../ui/utils/constants.js";
import { expectNoA11yViolations } from "./axe-helper.js";

const apiPostMock = vi.fn();
const apiGetMock = vi.fn();

vi.mock("../../../ui/composables/useApi.js", () => ({
  useApi: () => ({
    apiPost: (...args) => apiPostMock(...args),
    apiGet: (...args) => apiGetMock(...args),
  }),
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function mountView() {
  const modalTitle = ref("");
  const popView = vi.fn();
  const wrapper = mount(PairDeviceConfig, {
    attachTo: document.body,
    global: { provide: { modalTitle, popView } },
  });
  return { wrapper, modalTitle, popView };
}

describe("PairDeviceConfig", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiPostMock.mockReset();
    apiGetMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("starts pairing on mount and renders the QR code + link", async () => {
    apiPostMock.mockResolvedValue({
      ok: true,
      data: { id: "pr_1", url: "https://host/pair/pr_1?t=tok", expires_in_sec: 90 },
    });
    apiGetMock.mockResolvedValue({ ok: true, data: { status: "pending", expires_in_sec: 90 } });

    const { wrapper, modalTitle } = mountView();
    await flushPromises();

    expect(modalTitle.value).toBe("Add Device");
    expect(apiPostMock).toHaveBeenCalledWith("/auth/pairing/start");
    expect(wrapper.find(".pair-qr svg").exists()).toBe(true);
    expect(wrapper.text()).toContain("https://host/pair/pr_1?t=tok");
    expect(wrapper.text()).toContain("Expires in 1:30");
    wrapper.unmount();
  });

  it("counts down every second", async () => {
    apiPostMock.mockResolvedValue({
      ok: true,
      data: { id: "pr_1", url: "https://host/pair/pr_1?t=tok", expires_in_sec: 90 },
    });
    apiGetMock.mockResolvedValue({ ok: true, data: { status: "pending", expires_in_sec: 90 } });

    const { wrapper } = mountView();
    await flushPromises();
    expect(wrapper.text()).toContain("1:30");

    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.text()).toContain("1:29");
    wrapper.unmount();
  });

  it("shows an error and offers retry when start fails", async () => {
    apiPostMock.mockResolvedValue({ ok: false, data: null });

    const { wrapper } = mountView();
    await flushPromises();

    expect(wrapper.text()).toContain("Failed to start pairing.");
    expect(wrapper.find("button.primary").text()).toBe("Try again");
    wrapper.unmount();
  });

  it("polls status and shows success + closes when claimed", async () => {
    apiPostMock.mockResolvedValue({
      ok: true,
      data: { id: "pr_1", url: "https://host/pair/pr_1?t=tok", expires_in_sec: 90 },
    });
    apiGetMock.mockResolvedValue({ ok: true, data: { status: "claimed" } });

    const { wrapper, popView } = mountView();
    await flushPromises();

    await vi.advanceTimersByTimeAsync(PAIRING_STATUS_POLL_MS);
    await flushPromises();
    expect(wrapper.text()).toContain("Device paired successfully.");

    await vi.advanceTimersByTimeAsync(1200);
    expect(popView).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("shows expired state with a regenerate button when status expires", async () => {
    apiPostMock.mockResolvedValue({
      ok: true,
      data: { id: "pr_1", url: "https://host/pair/pr_1?t=tok", expires_in_sec: 90 },
    });
    apiGetMock.mockResolvedValue({ ok: true, data: { status: "expired" } });

    const { wrapper } = mountView();
    await flushPromises();

    await vi.advanceTimersByTimeAsync(PAIRING_STATUS_POLL_MS);
    await flushPromises();

    expect(wrapper.text()).toContain("This code expired.");
    expect(wrapper.find("button.primary").text()).toBe("Generate new code");
    wrapper.unmount();
  });

  it("has no a11y violations while showing the QR code", async () => {
    apiPostMock.mockResolvedValue({
      ok: true,
      data: { id: "pr_1", url: "https://host/pair/pr_1?t=tok", expires_in_sec: 90 },
    });
    apiGetMock.mockResolvedValue({ ok: true, data: { status: "pending", expires_in_sec: 90 } });

    const { wrapper } = mountView();
    await flushPromises();
    vi.useRealTimers();
    await expectNoA11yViolations(wrapper.element);
    wrapper.unmount();
  });
});
