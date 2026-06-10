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
import { nextTick } from "vue";
import ConfirmDialog from "../../../ui/components/ConfirmDialog.vue";
import PromptDialog from "../../../ui/components/PromptDialog.vue";
import GitActionBtn from "../../../ui/components/GitActionBtn.vue";
import AppToast from "../../../ui/components/AppToast.vue";
import FileItem from "../../../ui/components/FileItem.vue";
import SplitModeSelector from "../../../ui/components/SplitModeSelector.vue";
import RssFeedDialog from "../../../ui/components/RssFeedDialog.vue";
import WorkspaceGroupDialog from "../../../ui/components/WorkspaceGroupDialog.vue";
import { createPinia, setActivePinia } from "pinia";
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

describe("a11y: AppToast", () => {
  it("各タイプのトーストに a11y 違反が無い", async () => {
    const wrapper = mount(AppToast, { attachTo: document.body });
    wrapper.vm.show("Error message", "error");
    wrapper.vm.show("Success message", "success");
    wrapper.vm.show("Info message", "info");
    await nextTick();
    // Teleport to="body" のため body 全体を検査する
    await expectNoA11yViolations(document.body);
    wrapper.unmount();
  });
});

describe("a11y: FileItem", () => {
  it("ファイル行に a11y 違反が無い", async () => {
    const wrapper = mount(FileItem, {
      props: { label: "README.md", sizeText: "12 KB", mtimeText: "2h ago" },
      attachTo: document.body,
    });
    // FileItem のルートは <li>。<ul> への内包は親 (FileBrowser) の責務であり
    // 単体マウントでは構造が成立しないため list/listitem ルールは除外する。
    await expectNoA11yViolations(wrapper.element, {
      rules: { list: { enabled: false }, listitem: { enabled: false } },
    });
    wrapper.unmount();
  });
});

describe("a11y: RssFeedDialog", () => {
  it("RSS追加ダイアログに a11y 違反が無い", async () => {
    const wrapper = mount(RssFeedDialog, {
      props: { url: "", title: "" },
      attachTo: document.body,
    });
    await nextTick();
    await expectNoA11yViolations(wrapper.find(".rss-add-dialog").element);
    wrapper.unmount();
  });

  it("編集モードのダイアログに a11y 違反が無い", async () => {
    const wrapper = mount(RssFeedDialog, {
      props: {
        editingFeed: { id: "f1", url: "https://example.com/feed.xml", title: "Example" },
        url: "https://example.com/feed.xml",
        title: "Example",
        error: "Failed to save",
      },
      attachTo: document.body,
    });
    await nextTick();
    await expectNoA11yViolations(wrapper.find(".rss-add-dialog").element);
    wrapper.unmount();
  });
});

describe("a11y: WorkspaceGroupDialog", () => {
  it("グループ名入力ダイアログに a11y 違反が無い", async () => {
    setActivePinia(createPinia());
    const wrapper = mount(WorkspaceGroupDialog, { attachTo: document.body });
    wrapper.vm.openAdd();
    await nextTick();
    await expectNoA11yViolations(wrapper.find(".picker-group-dialog").element);
    wrapper.unmount();
  });

  it("リネームモードのダイアログに a11y 違反が無い", async () => {
    setActivePinia(createPinia());
    const wrapper = mount(WorkspaceGroupDialog, { attachTo: document.body });
    wrapper.vm.openRename({ id: "g1", name: "Tools" });
    await nextTick();
    await expectNoA11yViolations(wrapper.find(".picker-group-dialog").element);
    wrapper.unmount();
  });
});

describe("a11y: SplitModeSelector", () => {
  it("分割モード選択に a11y 違反が無い", async () => {
    const wrapper = mount(SplitModeSelector, {
      props: { currentMode: "normal", tabCount: 2 },
      attachTo: document.body,
    });
    await expectNoA11yViolations(wrapper.element);
    wrapper.unmount();
  });
});
