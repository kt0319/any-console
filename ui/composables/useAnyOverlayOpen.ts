import { watch } from "vue";
import { useLayoutStore } from "../stores/layout.ts";
import { useSessionListOverlay } from "./useSessionListOverlay.ts";
import { useSessionOpenNav } from "./useSessionOpenNav.ts";
import { useSettingsNav } from "./useSettingsNav.ts";
import { useWorkspaceDetailNav } from "./useWorkspaceDetailNav.ts";

/**
 * いずれかの全面オーバーレイが開いている間、layoutStore.isAnyOverlayOpen を立てる。
 * isAnyOverlayOpenは「いずれかのオーバーレイが表示中か」を表す既存フラグ（useTerminalInput/
 * useGlobalShortcutsがショートカット抑止に使う）。4つの独立オーバーレイに分離したためここで集約する。
 */
export function useAnyOverlayOpen() {
  const layoutStore = useLayoutStore();
  const { isOpen: isSessionListOverlayOpen } = useSessionListOverlay();
  const { isOpen: isSessionOpenNavOpen } = useSessionOpenNav();
  const { isOpen: isSettingsNavOpen } = useSettingsNav();
  const { isOpen: isWorkspaceDetailOpen } = useWorkspaceDetailNav();
  watch(
    [isSessionListOverlayOpen, isSessionOpenNavOpen, isSettingsNavOpen, isWorkspaceDetailOpen],
    ([sessionList, sessionOpen, settings, workspaceDetail]) => {
      layoutStore.isAnyOverlayOpen = sessionList || sessionOpen || settings || workspaceDetail;
    },
    { immediate: true },
  );
}
