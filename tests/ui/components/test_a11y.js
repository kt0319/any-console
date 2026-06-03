// @vitest-environment happy-dom
// @ts-check
/**
 * アクセシビリティ自動検査（axe-core）。
 *
 * docs/A11Y_AUDIT.md で手動監査・修正したコンポーネントを対象に、
 * 構造的な a11y 違反（ARIA・ロール・アクセシブルネーム等）が
 * 再混入しないことを CI で継続的に担保する。
 *
 * 色コントラスト・実機 SR 検証は対象外（axe-helper.js のコメント参照）。
 */
import { describe, it, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import ConfirmDialog from "../../../ui/components/ConfirmDialog.vue";
import PromptDialog from "../../../ui/components/PromptDialog.vue";
import GitActionBtn from "../../../ui/components/GitActionBtn.vue";
import { useConfirm } from "../../../ui/composables/useConfirm.js";
import { usePrompt } from "../../../ui/composables/usePrompt.js";
import { expectNoA11yViolations } from "./axe-helper.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("a11y: ConfirmDialog", () => {
  it("確認ダイアログに a11y 違反が無い", async () => {
    const wrapper = mount(ConfirmDialog, { attachTo: document.body });
    const { confirm, onCancel } = useConfirm();
    confirm("Delete file \"foo.txt\"? This cannot be undone.");
    await Promise.resolve();
    await expectNoA11yViolations(wrapper.find(".confirm-dialog").element);
    onCancel();
    wrapper.unmount();
  });
});

describe("a11y: PromptDialog", () => {
  it("入力ダイアログに a11y 違反が無い", async () => {
    const wrapper = mount(PromptDialog, { attachTo: document.body });
    const { prompt } = usePrompt();
    prompt({ title: "Rename", message: "New name", initialValue: "old.txt" });
    await Promise.resolve();
    await expectNoA11yViolations(wrapper.find(".prompt-dialog").element);
    wrapper.unmount();
  });
});

describe("a11y: GitActionBtn", () => {
  it("アイコンボタンにアクセシブルネームがある", async () => {
    const wrapper = mount(GitActionBtn, {
      props: { icon: "pull", title: "Pull" },
      attachTo: document.body,
    });
    await expectNoA11yViolations(wrapper.element);
    wrapper.unmount();
  });
});
