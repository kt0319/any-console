import { ref } from "vue";
import { useAuthStore } from "../stores/auth.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useSessionSync } from "./useSessionSync.ts";
import { useStatusStream } from "./useStatusStream.ts";
import { useToast } from "./useToast.ts";
import { useCircleKeyPadConfigStore } from "../stores/circle-keypad-config.ts";
import { useInfoPillConfigStore } from "../stores/info-pill-config.ts";
import { EP_TERMINAL_SESSIONS, EP_JOBS_WORKSPACES, EP_SETTINGS_CONFIG_HEALTH } from "../utils/endpoints.ts";
import { on } from "../app-bridge.js";

// useToast は未型付けのため、利用するメソッドの型をここで明示する。
type ToastFn = (message: string, opts?: { duration?: number, action?: string | object }) => void;

function waitForNextEvent(eventName: string) {
  return new Promise((resolve) => {
    const cleanup = on(eventName, (detail) => {
      cleanup();
      resolve(detail);
    });
  });
}

export function useAppBootstrap() {
  const auth = useAuthStore();
  const workspaceStore = useWorkspaceStore();
  const terminalStore = useTerminalStore();
  const { restoreExistingSessions } = useSessionSync();
  const statusStream = useStatusStream();
  const toast: Record<"success" | "error" | "info" | "warning", ToastFn> = useToast();

  const booting = ref(true);
  const bootMessage = ref("Loading...");

  async function initializeApp() {
    bootMessage.value = "Loading...";

    const workspacesPromise = workspaceStore.fetchWorkspaces().then(() => {
      if (!workspaceStore.selectedWorkspace) {
        const first = workspaceStore.allWorkspaces[0];
        if (first) workspaceStore.selectedWorkspace = first.name;
      }
    }).catch((e) => console.error("workspaces fetch failed:", e));

    const sessionsPromise = auth.apiFetch(EP_TERMINAL_SESSIONS).catch(() => null);
    const jobsPromise = auth.apiFetch(EP_JOBS_WORKSPACES).catch(() => null);
    const healthPromise = auth.apiFetch(EP_SETTINGS_CONFIG_HEALTH).catch(() => null);
    useCircleKeyPadConfigStore().load();
    useInfoPillConfigStore().load();

    const [, sessionsRes, jobsRes, healthRes] = await Promise.all([workspacesPromise, sessionsPromise, jobsPromise, healthPromise]);

    if (healthRes?.ok) {
      const health = await healthRes.json();
      if (!health.ok) {
        const versionError = (health.errors || []).find((e) => e.key === "__version__");
        let msg: string;
        if (versionError) {
          msg = versionError.message;
        } else if (health.source === "config.bak") {
          msg = "Config was restored from backup. Some settings may be missing.";
        } else {
          msg = `Config has validation errors: ${health.errors.map((e) => e.key).join(", ")}`;
        }
        toast.warning(msg);
      }
    }

    bootMessage.value = "Restoring sessions...";
    await restoreExistingSessions(sessionsRes, jobsRes);

    // restoreExistingSessions は復元したタブの WS 接続を layout:fitAll イベント経由で
    // 遅延実行する（DOM 未マウントのため）。ここで待たずに booting を解除すると、
    // ダイアログが消えた直後にまだ未接続のタブが見えてしまう。
    if (terminalStore.openTabs.length > 0) {
      await waitForNextEvent("layout:fitAll");
    }

    workspaceStore.fetchStatuses();
    statusStream.start();
  }

  return { booting, bootMessage, initializeApp };
}
