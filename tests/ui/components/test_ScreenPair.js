// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import ScreenPair from "../../../ui/components/ScreenPair.vue";
import { expectNoA11yViolations } from "./axe-helper.js";

const claimPairingMock = vi.fn();

vi.mock("../../../ui/stores/auth.js", () => ({
  useAuthStore: () => ({ claimPairing: (...args) => claimPairingMock(...args) }),
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("ScreenPair", () => {
  let originalHref;

  beforeEach(() => {
    claimPairingMock.mockReset();
    originalHref = window.location.href;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.location.href = originalHref;
  });

  it("claims the pairing on mount and redirects on success", async () => {
    claimPairingMock.mockResolvedValue({ ok: true, deviceId: "dev_1", name: "iPhone" });
    const wrapper = mount(ScreenPair, {
      props: { pairingId: "pr_1", pairingToken: "tok" },
      attachTo: document.body,
    });
    expect(wrapper.text()).toContain("Signing in...");
    await flushPromises();

    expect(claimPairingMock).toHaveBeenCalledWith("pr_1", "tok");
    expect(wrapper.text()).toContain("Signed in.");
    wrapper.unmount();
  });

  it("shows an error with a fallback to token login on failure", async () => {
    claimPairingMock.mockResolvedValue({ ok: false, error: "This pairing link has expired or was already used" });
    const wrapper = mount(ScreenPair, {
      props: { pairingId: "pr_1", pairingToken: "tok" },
      attachTo: document.body,
    });
    await flushPromises();

    expect(wrapper.text()).toContain("This pairing link has expired or was already used");
    expect(wrapper.find("button.primary").text()).toBe("Enter token instead");
    expect(claimPairingMock).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("shows an error without calling claim when the token is missing from the url", async () => {
    const wrapper = mount(ScreenPair, {
      props: { pairingId: "pr_1", pairingToken: "" },
      attachTo: document.body,
    });
    await flushPromises();

    expect(claimPairingMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("This link is missing its pairing code.");
    wrapper.unmount();
  });

  it("has no a11y violations in the error state", async () => {
    claimPairingMock.mockResolvedValue({ ok: false, error: "Pairing failed." });
    const wrapper = mount(ScreenPair, {
      props: { pairingId: "pr_1", pairingToken: "tok" },
      attachTo: document.body,
    });
    await flushPromises();
    await expectNoA11yViolations(wrapper.element);
    wrapper.unmount();
  });
});
