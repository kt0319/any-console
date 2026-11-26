// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import PairDeviceConfig from "../../../ui/components/PairDeviceConfig.vue";
import {
  PAIRING_STATUS_POLL_MS,
  PAIRING_SUCCESS_CLOSE_DELAY_MS,
  PAIRING_COUNTDOWN_TICK_MS,
} from "../../../ui/utils/constants.ts";
import { expectNoA11yViolations } from "./axe-helper.js";

const apiPostMock = vi.fn();
const apiGetMock = vi.fn();

vi.mock("../../../ui/composables/useApi.ts", () => ({
  useApi: () => ({
    apiPost: (...args) => apiPostMock(...args),
    apiGet: (...args) => apiGetMock(...args),
  }),
}));

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

  it("shows the server's specific error detail when start fails with a reason", async () => {
    // localhost経由でTailscaleホスト名を解決できない場合(server/src/pairing.rs build_pairing_url)も具体的な理由を表示する。
    apiPostMock.mockResolvedValue({
      ok: false,
      data: {
        detail: "Cannot build a link reachable from another device while viewing "
          + "any-console via localhost. Open it via its LAN or Tailscale address instead.",
      },
    });

    const { wrapper } = mountView();
    await flushPromises();

    expect(wrapper.text()).toContain("Open it via its LAN or Tailscale address instead.");
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

    // close演出(1.2秒待ち)中にモーダルが閉じられても、残ったsetTimeoutがunmount後にpopViewを呼ばないこと。
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(PAIRING_SUCCESS_CLOSE_DELAY_MS);
    expect(popView).not.toHaveBeenCalled();
  });

  it("ignores a status response that resolves after the component has unmounted", async () => {
    apiPostMock.mockResolvedValue({
      ok: true,
      data: { id: "pr_1", url: "https://host/pair/pr_1?t=tok", expires_in_sec: 90 },
    });
    let resolvePoll;
    apiGetMock.mockReturnValueOnce(new Promise((resolve) => { resolvePoll = resolve; }));

    const { wrapper, popView } = mountView();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(PAIRING_STATUS_POLL_MS);

    wrapper.unmount();

    // pairingIdは不変でstale-id比較では弾けないため、unmountフラグで無視されること。
    resolvePoll({ ok: true, data: { status: "claimed" } });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(PAIRING_SUCCESS_CLOSE_DELAY_MS);
    expect(popView).not.toHaveBeenCalled();
  });

  it("ignores a stale status response from a superseded pairing", async () => {
    apiPostMock
      .mockResolvedValueOnce({
        ok: true,
        data: { id: "pr_1", url: "https://host/pair/pr_1?t=tok1", expires_in_sec: 90 },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { id: "pr_2", url: "https://host/pair/pr_2?t=tok2", expires_in_sec: 90 },
      });

    let resolveStalePoll;
    const stalePollPromise = new Promise((resolve) => { resolveStalePoll = resolve; });
    apiGetMock.mockReturnValueOnce(stalePollPromise);
    apiGetMock.mockResolvedValueOnce({ ok: true, data: { status: "expired" } });

    const { wrapper } = mountView();
    await flushPromises();

    await vi.advanceTimersByTimeAsync(PAIRING_STATUS_POLL_MS);
    expect(wrapper.text()).toContain("https://host/pair/pr_1?t=tok1");

    await vi.advanceTimersByTimeAsync(PAIRING_STATUS_POLL_MS);
    await flushPromises();
    expect(wrapper.text()).toContain("This code expired.");

    apiGetMock.mockResolvedValue({ ok: true, data: { status: "pending", expires_in_sec: 90 } });
    await wrapper.find("button.primary").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("https://host/pair/pr_2?t=tok2");

    // pr_1宛の古いポーリング応答(1回目)がここで初めて解決する。pr_2の状態を
    // 上書きしてはならない(claimed表示やタイマー停止が誤発火しないこと)。
    resolveStalePoll({ ok: true, data: { status: "claimed" } });
    await flushPromises();
    expect(wrapper.text()).toContain("https://host/pair/pr_2?t=tok2");
    expect(wrapper.text()).not.toContain("Device paired successfully.");
  });

  it("keeps polling after the local countdown reaches zero until the server confirms an outcome", async () => {
    // サーバはclaim進行中のエントリをexpires_at後もpendingのまま保持し後からclaimedにする(server/src/pairing.rs claim_pairing)。
    // カウントダウン0でpollを止めると、その遅れたclaimedを観測できなくなる。
    apiPostMock.mockResolvedValue({
      ok: true,
      data: { id: "pr_1", url: "https://host/pair/pr_1?t=tok", expires_in_sec: 1 },
    });
    apiGetMock.mockResolvedValue({ ok: true, data: { status: "pending", expires_in_sec: 0 } });

    const { wrapper } = mountView();
    await flushPromises();

    await vi.advanceTimersByTimeAsync(PAIRING_COUNTDOWN_TICK_MS);
    expect(wrapper.text()).toContain("0:00");
    expect(wrapper.text()).not.toContain("This code expired.");

    apiGetMock.mockResolvedValue({ ok: true, data: { status: "claimed" } });
    await vi.advanceTimersByTimeAsync(PAIRING_STATUS_POLL_MS);
    await flushPromises();
    expect(wrapper.text()).toContain("Device paired successfully.");
    wrapper.unmount();
  });

  it("ignores a stale poll response that resolves while regeneration's own request is still in flight", async () => {
    // pairingId比較だけでは、新しいstart()がapiPost待ちでpairingIdを書き換える前の間隙をすり抜ける。
    // start()冒頭で同期的に進める世代カウンタがこの間隙も弾くこと。
    apiPostMock.mockResolvedValueOnce({
      ok: true,
      data: { id: "pr_1", url: "https://host/pair/pr_1?t=tok1", expires_in_sec: 90 },
    });

    let resolveStalePoll;
    const stalePollPromise = new Promise((resolve) => { resolveStalePoll = resolve; });
    apiGetMock.mockReturnValueOnce(stalePollPromise);
    apiGetMock.mockResolvedValueOnce({ ok: true, data: { status: "expired" } });

    const { wrapper, popView } = mountView();
    await flushPromises();

    await vi.advanceTimersByTimeAsync(PAIRING_STATUS_POLL_MS);
    expect(wrapper.text()).toContain("https://host/pair/pr_1?t=tok1");

    await vi.advanceTimersByTimeAsync(PAIRING_STATUS_POLL_MS);
    await flushPromises();
    expect(wrapper.text()).toContain("This code expired.");

    let resolveRestart;
    const restartPromise = new Promise((resolve) => { resolveRestart = resolve; });
    apiPostMock.mockReturnValueOnce(restartPromise);

    await wrapper.find("button.primary").trigger("click");
    // start()は世代カウンタを進め済みだが、apiPostは未解決でpairingIdは"pr_1"のまま。
    await flushPromises();

    resolveStalePoll({ ok: true, data: { status: "claimed" } });
    await flushPromises();
    expect(wrapper.text()).not.toContain("Device paired successfully.");
    expect(popView).not.toHaveBeenCalled();

    resolveRestart({
      ok: true,
      data: { id: "pr_2", url: "https://host/pair/pr_2?t=tok2", expires_in_sec: 90 },
    });
    apiGetMock.mockResolvedValue({ ok: true, data: { status: "pending", expires_in_sec: 90 } });
    await flushPromises();
    expect(wrapper.text()).toContain("https://host/pair/pr_2?t=tok2");
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
