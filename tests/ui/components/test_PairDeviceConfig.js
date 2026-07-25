// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import PairDeviceConfig from "../../../ui/components/PairDeviceConfig.vue";
import {
  PAIRING_STATUS_POLL_MS,
  PAIRING_SUCCESS_CLOSE_DELAY_MS,
  PAIRING_COUNTDOWN_TICK_MS,
} from "../../../ui/utils/constants.js";
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

  it("ignores a status response that resolves after the component has unmounted", async () => {
    apiPostMock.mockResolvedValue({
      ok: true,
      data: { id: "pr_1", url: "https://host/pair/pr_1?t=tok", expires_in_sec: 90 },
    });
    let resolvePoll;
    apiGetMock.mockReturnValueOnce(new Promise((resolve) => { resolvePoll = resolve; }));

    const { wrapper, popView } = mountView();
    await flushPromises();
    // pollを1回発火させる(応答はまだ保留のまま = in-flight)
    await vi.advanceTimersByTimeAsync(PAIRING_STATUS_POLL_MS);

    // 応答が返る前にユーザーがモーダルを閉じる
    wrapper.unmount();

    // in-flightだったpollがここで初めて解決する。pairingIdは変わっていない
    // (stale-id比較だけでは検知できない)ため、unmountフラグで無視されること。
    resolvePoll({ ok: true, data: { status: "claimed" } });
    await flushPromises();
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

  it("ignores a stale poll response that resolves while regeneration's own request is still in flight", async () => {
    // pairingId比較だけに頼ると、新しいstart()がまだ自身のapiPostをawait中で
    // pairingId.valueをpr_2へ書き換える前の間隙をすり抜けてしまう。世代カウンタ
    // (start()の冒頭で同期的にインクリメント)がこの間隙も含めて弾くことを確認する。
    apiPostMock.mockResolvedValueOnce({
      ok: true,
      data: { id: "pr_1", url: "https://host/pair/pr_1?t=tok1", expires_in_sec: 3 },
    });

    let resolveStalePoll;
    const stalePollPromise = new Promise((resolve) => { resolveStalePoll = resolve; });
    apiGetMock.mockReturnValueOnce(stalePollPromise);

    const { wrapper, popView } = mountView();
    await flushPromises();

    // pr_1のポーリングを1回発火させる(応答はまだ保留のまま = in-flight)。
    // expires_in_sec=3なので、この時点(2s後)ではまだローカルにexpired化しない
    // (3s目のtickで初めてexpireする)。
    await vi.advanceTimersByTimeAsync(PAIRING_STATUS_POLL_MS);
    expect(wrapper.text()).toContain("https://host/pair/pr_1?t=tok1");

    // 「Generate new code」に相当する再start()を、apiPostがまだ解決しない
    // 状態でトリガーする(pairingId.valueはまだ"pr_1"のまま)。
    let resolveRestart;
    const restartPromise = new Promise((resolve) => { resolveRestart = resolve; });
    apiPostMock.mockReturnValueOnce(restartPromise);

    // カウントダウンを尽きさせてローカルにexpired扱いにする(pr_1のpollタイマー停止)。
    await vi.advanceTimersByTimeAsync(PAIRING_COUNTDOWN_TICK_MS);
    expect(wrapper.text()).toContain("This code expired.");

    await wrapper.find("button.primary").trigger("click");
    // この時点でstart()は既にpairingGenerationを同期的に進めているが、
    // apiPost(restartPromise)自体はまだ解決していない = pairingId.valueは
    // まだ"pr_1"のまま。
    await flushPromises();

    // pr_1宛の古いpoll応答が、再start()のapiPostが解決するより先に届く。
    resolveStalePoll({ ok: true, data: { status: "claimed" } });
    await flushPromises();
    expect(wrapper.text()).not.toContain("Device paired successfully.");
    expect(popView).not.toHaveBeenCalled();

    // 再start()のapiPostがここでようやく解決する。
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
