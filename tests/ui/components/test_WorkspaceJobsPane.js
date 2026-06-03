// @vitest-environment happy-dom
// @ts-check
/**
 * WorkspaceJobsPane のアクセシビリティ・構造テスト。
 *
 * ジョブ行はクリック実行と編集ボタンを持つ。両者を両立させつつ
 * キーボード操作可能にするため、行は「実行ボタン + 編集ボタンの兄弟」構造とし、
 * 操作要素のネスト（nested-interactive）を避けている（docs/A11Y_AUDIT.md TODO #7）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { expectNoA11yViolations } from "./axe-helper.js";

vi.mock("../../../ui/app-bridge.js", () => ({
  emit: vi.fn(),
  on: vi.fn(() => () => {}),
}));

vi.mock("../../../ui/composables/useApi.js", () => ({
  useApi: () => ({
    apiGet: vi.fn(async () => ({
      ok: true,
      data: {
        ws1: {
          deploy: { label: "Deploy", common: false, command: "make deploy", description: "ship it" },
        },
      },
    })),
  }),
}));

let wrapper;

beforeEach(async () => {
  setActivePinia(createPinia());
  const { useWorkspaceStore } = await import("../../../ui/stores/workspace.js");
  const store = useWorkspaceStore();
  store.allWorkspaces = [{ name: "ws1", icon: "mdi-folder" }];
  store.selectedWorkspace = "ws1";

  const { default: WorkspaceJobsPane } = await import("../../../ui/components/WorkspaceJobsPane.vue");
  wrapper = mount(WorkspaceJobsPane, {
    global: { provide: { pushView: vi.fn() } },
    attachTo: document.body,
  });
  await nextTick();
  await nextTick();
});

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = "";
});

describe("WorkspaceJobsPane a11y", () => {
  it("ジョブ行の実行領域が button 要素である（キーボード操作可能）", () => {
    const jobButtons = document.body.querySelectorAll("button.job-item");
    expect(jobButtons.length).toBeGreaterThan(0);
    expect(document.body.querySelector("div.job-item")).toBeNull();
  });

  it("編集ボタンは実行ボタンの内側ではなく兄弟要素である", () => {
    const editBtn = document.body.querySelector(".job-item-edit-btn");
    expect(editBtn).not.toBeNull();
    // 実行ボタン(.job-item)の内側に編集ボタンが無いこと（ネスト解消）
    expect(document.body.querySelector(".job-item .job-item-edit-btn")).toBeNull();
  });

  it("a11y 違反が無い（nested-interactive を含む）", async () => {
    await expectNoA11yViolations(document.body);
  });
});
