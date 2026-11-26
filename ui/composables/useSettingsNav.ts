import { on } from "../app-bridge.ts";
import { createViewStackNav } from "./createViewStackNav.ts";
import { useWorkspaceDetailNav } from "./useWorkspaceDetailNav.ts";
import { useSessionListOverlay } from "./useSessionListOverlay.ts";
import { useExclusiveOverlay } from "./useExclusiveOverlay.ts";

// Settings 専用のビュースタック。ルートは SettingsMenu 固定で、実装本体は createViewStackNav.ts（useSessionOpenNav と共通）。

const ROOT_VIEW = "SettingsMenu";

const nav = createViewStackNav({ rootView: ROOT_VIEW, overlayKey: "settings" });
const { openView, closeNav } = nav;

let listenersRegistered = false;

function registerListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  const { registerOverlay } = useExclusiveOverlay();
  registerOverlay("settings", closeNav);

  on("settings:open", (detail) => {
    if (detail?.view) {
      // circle keypad の Preview プリセット（circle-keypad-presets.ts）は
      // PreviewPorts の view 名で発火するため、Settings 配下に統合された
      // ServerProcesses（Dev Server）へ読み替える。
      let view = detail.view;
      if (view === "PreviewPorts") view = "ServerProcesses";
      // SessionList はセッション一覧オーバーレイ側の管轄のため、積まずリダイレクトする（circle keypad の Tabs プリセットがこの view 名で発火する）。
      if (view === "SessionList") {
        useSessionListOverlay().open();
        return;
      }
      const state = detail.state || {};
      const stack = [{ view: ROOT_VIEW, state: {} }];
      // PairDeviceConfigは通常AuthConfig配下からのみ遷移するビューのため、
      // 直接開く場合もAuthConfigを積んでおき、戻る操作でAuthConfigに戻れるようにする
      if (view === "PairDeviceConfig") stack.push({ view: "AuthConfig", state: {} });
      stack.push({ view, state });
      openView(stack);
    } else {
      openView(ROOT_VIEW);
    }
  });

  // WorkspaceDetail は Settings のスタックとは独立（useWorkspaceDetailNav.ts）。
  const { open: openWorkspaceDetail } = useWorkspaceDetailNav();

  on("git:openFileModal", (detail) => openWorkspaceDetail(detail));

  on("git:openGitHub", () => openWorkspaceDetail({ pane: "issues" }));

  on("modal:close", () => closeNav());
}

export function useSettingsNav() {
  registerListeners();
  return { ...nav };
}
