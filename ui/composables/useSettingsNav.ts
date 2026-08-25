import { on } from "../app-bridge.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { createViewStackNav } from "./createViewStackNav.ts";
import { useWorkspaceDetailNav } from "./useWorkspaceDetailNav.ts";
import { useSessionListOverlay } from "./useSessionListOverlay.ts";
import { useExclusiveMobileOverlay } from "./useExclusiveMobileOverlay.ts";

// Settings専用のビュースタック（旧Modal.vueが単独で持っていた状態）を
// モジュールスコープの単一状態に抽出したもの。タブバーの歯車ボタンから
// TerminalSettingsModal.vue（PC/モバイル共通、WorkspaceDetailModal.vueと
// 同じ全面オーバーレイ）が開く。セッション一覧・Open Sessionとは完全に
// 独立した系列で、ルートはModalMenu固定（ここから外れない）。
//
// ビュースタックの実装本体は createViewStackNav.ts（useSessionOpenNav と共通）。
// 個々の設定画面（ModalMenu/TerminalConfig/...）は useModalView() 経由で
// modalTitle/modalBranch/viewState/pushView/popView/updateViewState を
// injectするインターフェースのまま変わらない（provideする側がTerminalSettingsModal.vue
// になるだけ）。

const ROOT_VIEW = "ModalMenu";

const nav = createViewStackNav({ rootView: ROOT_VIEW, overlayKey: "settings" });
const { openView, closeNav } = nav;

let workspaceStore: ReturnType<typeof useWorkspaceStore> | null = null;

let listenersRegistered = false;

function registerListeners() {
  // ストア参照は呼び出しの都度、その時点でアクティブなPiniaに合わせて
  // 更新する（テストで setActivePinia(createPinia()) するたびに新しい
  // インスタンスへ切り替わるようにするため）。
  workspaceStore = useWorkspaceStore();

  if (listenersRegistered) return;
  listenersRegistered = true;

  const { registerOverlay } = useExclusiveMobileOverlay();
  registerOverlay("settings", closeNav);

  on("settings:open", (detail) => {
    if (detail?.view) {
      // circle keypad の Preview プリセット（circle-keypad-presets.ts）は
      // PreviewPorts の view 名で発火するため、Settings 配下に統合された
      // SessionPreview（Dev Server）へ読み替える。
      let view = detail.view;
      if (view === "PreviewPorts") view = "SessionPreview";
      // SessionListはSettings/Open Session分離でセッション一覧
      // オーバーレイ側の管轄になったため、このスタックには積まずリダイレクトする
      //（circle keypad の Tabs プリセットがこの view 名で発火する）。
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

  // WorkspaceDetail（Files/Changes/History等）はSettingsのスタックとは
  // 独立したuseWorkspaceDetailNav.tsで開閉する（設定側の表示はそのまま
  // 変えない。WorkspaceDetailModal.vueが全面オーバーレイで表示する）。
  const { open: openWorkspaceDetail } = useWorkspaceDetailNav();

  on("git:openFileModal", (detail) => openWorkspaceDetail(detail));

  on("git:openGitHub", () => openWorkspaceDetail({ pane: "issues" }));

  on("git:openHistory", ({ wsName }: { wsName?: string } = {}) => {
    if (workspaceStore && wsName) workspaceStore.selectedWorkspace = wsName;
    openWorkspaceDetail({ pane: "history" });
  });

  on("modal:close", () => closeNav());
}

export function useSettingsNav() {
  registerListeners();
  return { ...nav };
}
