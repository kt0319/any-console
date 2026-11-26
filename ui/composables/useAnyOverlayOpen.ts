import { watch } from "vue";
import { useLayoutStore } from "../stores/layout.ts";
import { useSessionListOverlay } from "./useSessionListOverlay.ts";
import { useSessionOpenNav } from "./useSessionOpenNav.ts";
import { useSettingsNav } from "./useSettingsNav.ts";
import { useWorkspaceDetailNav } from "./useWorkspaceDetailNav.ts";

/** いずれかの全面オーバーレイが開いている間 layoutStore.isAnyOverlayOpen を立てる。
useTerminalInput / useGlobalShortcuts がショートカット抑止に使う。 */
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
