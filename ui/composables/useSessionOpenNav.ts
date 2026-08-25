import { on } from "../app-bridge.ts";
import { createViewStackNav } from "./createViewStackNav.ts";
import { useExclusiveMobileOverlay } from "./useExclusiveMobileOverlay.ts";

// Open Session系列（WorkspaceOpen/WorkspaceAdd/WorkspaceEdit/JobConfig/
// IconPicker）専用のビュースタック（SessionOpenModal.vueがホストする）。
// タブバーの「+」ボタンから開き、SettingsやSessionListとは完全に独立して
// 開閉する。実装本体は createViewStackNav.ts（useSettingsNav と共通）。
//
// isOpenはスタック深さ（canNavigateBack相当）では判定できない —
// WorkspaceOpenルート自体が「開いている」状態を表すため、明示的なrefで持つ
// （useWorkspaceDetailNav.tsと同様の考え方）。

const nav = createViewStackNav({ rootView: "WorkspaceOpen", overlayKey: "sessionOpen" });
const { openView, closeNav } = nav;

let listenersRegistered = false;

function registerListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  const { registerOverlay } = useExclusiveMobileOverlay();
  registerOverlay("sessionOpen", closeNav);

  on("workspace:openModal", () => openView([{ view: "WorkspaceOpen", state: {} }]));
}

/**
 * WorkspaceAdd を（WorkspaceOpen をルートに積んだ状態で）直接開く。
 * 呼び出し元が1箇所（InfoPill の Add ピル）だけの経路のため、
 * バスイベントではなく直接呼び出しにしている。
 */
export function openWorkspaceAdd(detail: Record<string, unknown> = {}) {
  openView([
    { view: "WorkspaceOpen", state: {} },
    { view: "WorkspaceAdd", state: { ...detail } },
  ]);
}

export function useSessionOpenNav() {
  registerListeners();
  return { ...nav };
}
