// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import PairDeviceConfig from "../../../ui/components/PairDeviceConfig.vue";
import { PAIRING_STATUS_POLL_MS, PAIRING_SUCCESS_CLOSE_DELAY_MS } from "../../../ui/utils/constants.js";
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

    await vi.advanceTimersByTimeAsync(PAIRING_SUCCESS_CLOSE_DELAY_MS);
    expect(popView).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("cancels the pending close timer when unmounted before it fires", async () => {
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

    // ユーザーがclose演出の途中(1.2秒待ち)でモーダルを閉じたケース。
    // pending中のsetTimeoutがunmount後に生き残ってpopViewを呼んでしまうと、
    // 既に別の画面に移っているviewStackを誤って操作してしまう。
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(PAIRING_SUCCESS_CLOSE_DELAY_MS);
    expect(popView).not.toHaveBeenCalled();
  });

  it("ignores a stale status response from a superseded pairing", async () => {
    apiPostMock
      .mockResolvedValueOnce({
        ok: true,
        data: { id: "pr_1", url: "https://host/pair/pr_1?t=tok1", expires_in_sec: 1 },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { id: "pr_2", url: "https://host/pair/pr_2?t=tok2", expires_in_sec: 90 },
      });

    let resolveStalePoll;
    const stalePollPromise = new Promise((resolve) => { resolveStalePoll = resolve; });
    apiGetMock.mockReturnValueOnce(stalePollPromise);

    const { wrapper } = mountView();
    await flushPromises();

    // pr_1のポーリングを1回発火させる(応答はまだ保留のまま = in-flight)
    await vi.advanceTimersByTimeAsync(PAIRING_STATUS_POLL_MS);
    // カウントダウンが尽きてローカルにexpired扱いになり、pr_1のタイマーは止まる
    // (in-flightのfetch自体はキャンセルされない)
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.text()).toContain("This code expired.");

    // ユーザーが新しいコードを生成する(pr_2へ切り替わる)
    apiGetMock.mockResolvedValue({ ok: true, data: { status: "pending", expires_in_sec: 90 } });
    await wrapper.find("button.primary").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("https://host/pair/pr_2?t=tok2");

    // pr_1宛の古いポーリング応答がここで初めて解決する。pr_2の状態を
    // 上書きしてはならない(claimed表示やタイマー停止が誤発火しないこと)。
    resolveStalePoll({ ok: true, data: { status: "claimed" } });
    await flushPromises();
    expect(wrapper.text()).toContain("https://host/pair/pr_2?t=tok2");
    expect(wrapper.text()).not.toContain("Device paired successfully.");
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
