// @vitest-environment happy-dom
// @ts-check
/** 統合テスト: Confirm / Prompt ダイアログ */
import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { useConfirm } from "../../../ui/composables/useConfirm.ts";
import { usePrompt } from "../../../ui/composables/usePrompt.ts";
import { on } from "../../../ui/app-bridge.ts";
import ConfirmDialog from "../../../ui/components/ConfirmDialog.vue";
import PromptDialog from "../../../ui/components/PromptDialog.vue";

describe("Dialog accessibility behavior", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("ConfirmDialog traps Tab focus inside the dialog", async () => {
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);

    const wrapper = mount(ConfirmDialog, { attachTo: document.body });
    const { confirm, onCancel } = useConfirm();
    const pending = confirm("Delete file?");
    await Promise.resolve();

    const buttons = wrapper.findAll("button");
    const first = buttons[0].element;
    const last = buttons[buttons.length - 1].element;
    const dialog = wrapper.find(".confirm-dialog");

    last.focus();
    await dialog.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    await dialog.trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    onCancel();
    await expect(pending).resolves.toBe(false);
    wrapper.unmount();
    document.body.innerHTML = "";
  });

  it("PromptDialog closes on Escape even when a button is focused", async () => {
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    outside.focus();

    const wrapper = mount(PromptDialog, { attachTo: document.body });
    const { prompt } = usePrompt();
    const pending = prompt({ title: "Rename", initialValue: "old.txt" });
    await Promise.resolve();

    const cancelButton = wrapper.find(".dialog-btn-cancel").element;
    cancelButton.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    await expect(pending).resolves.toBe(null);
    expect(document.activeElement).toBe(outside);

    wrapper.unmount();
    document.body.innerHTML = "";
  });
});
